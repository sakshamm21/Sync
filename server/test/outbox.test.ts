// Regression tests for the email pipeline (docs/IMPROVEMENT_PLAN.md, PR 4).
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Notification, OutboxEmail, Registration } from '../src/models';
import { drainOutbox, queueMail, MAX_ATTEMPTS } from '../src/jobs/outbox';
import { sendDueReminders } from '../src/jobs/eventReminders';
import { pruneOldData } from '../src/jobs/maintenance';
import { setTestTransport, type MailInput } from '../src/lib/mailer';
import { settleBackground } from '../src/lib/background';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);
afterEach(async () => {
  await settleBackground();
  setTestTransport(null);
});

const mail = (to = 'a@example.com'): MailInput => ({ to, subject: 'Hello', text: 'hi', html: '<p>hi</p>' });

/** Lets every row be due again, as if the backoff had passed. */
const skipBackoff = () => OutboxEmail.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });

describe('B6: failed emails are retried', () => {
  it('delivers on the third drain after two failures', async () => {
    let calls = 0;
    const delivered: string[] = [];
    setTestTransport(async (m) => {
      calls += 1;
      if (calls <= 2) throw new Error('Brevo timed out');
      delivered.push(m.to);
    });
    await OutboxEmail.create({ ...mail(), attempts: 0 });

    assert.equal(await drainOutbox(), 0);
    let row = await OutboxEmail.findOne({});
    assert.equal(row!.attempts, 1);
    assert.equal(row!.failedAt, null);
    assert.match(row!.lastError!, /timed out/);
    assert.ok(row!.nextAttemptAt! > new Date(), 'backs off before trying again');

    // Not due yet: nothing is sent.
    assert.equal(await drainOutbox(), 0);
    assert.equal(calls, 1);

    await skipBackoff();
    assert.equal(await drainOutbox(), 0);
    await skipBackoff();
    assert.equal(await drainOutbox(), 1);
    row = await OutboxEmail.findOne({});
    assert.ok(row!.sentAt);
    assert.equal(row!.attempts, 3);
    assert.deepEqual(delivered, ['a@example.com']);
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts`, async () => {
    setTestTransport(async () => {
      throw new Error('down');
    });
    await OutboxEmail.create({ ...mail(), attempts: 0 });
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
      await drainOutbox();
      await skipBackoff();
    }
    const row = await OutboxEmail.findOne({});
    assert.equal(row!.attempts, MAX_ATTEMPTS);
    assert.ok(row!.failedAt);
  });

  it('does not retry a permanent rejection', async () => {
    setTestTransport(async () => {
      throw Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 });
    });
    await OutboxEmail.create({ ...mail(), attempts: 0 });
    await drainOutbox();
    const row = await OutboxEmail.findOne({});
    assert.equal(row!.attempts, 1);
    assert.ok(row!.failedAt);
  });

  it('prunes abandoned emails after 30 days', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await OutboxEmail.create({ ...mail(), failedAt: old });
    await OutboxEmail.create({ ...mail('b@example.com'), failedAt: new Date() });
    const pruned = await pruneOldData();
    assert.equal(pruned.emails, 1);
    assert.equal(await OutboxEmail.countDocuments(), 1);
  });
});

describe('B7: emails leave soon after they are queued', () => {
  it('drains the whole queue in one run, not 25 at a time', async () => {
    let sent = 0;
    setTestTransport(async () => {
      sent += 1;
    });
    await OutboxEmail.insertMany(Array.from({ length: 60 }, (_, i) => ({ ...mail(`u${i}@example.com`), attempts: 0 })));
    assert.equal(await drainOutbox(), 60);
    assert.equal(sent, 60);
  });

  it('starts a drain as soon as mail is queued', async () => {
    const delivered: string[] = [];
    setTestTransport(async (m) => {
      delivered.push(m.to);
    });
    await queueMail(mail('x@example.com'), mail('y@example.com'));
    await settleBackground();
    assert.deepEqual(delivered.sort(), ['x@example.com', 'y@example.com']);
  });

  it('a waitlist promotion email goes out with the request', async () => {
    const delivered: string[] = [];
    setTestTransport(async (m) => {
      delivered.push(m.to);
    });
    const owner = await createUser({ role: 'organizer' });
    const [a, b] = [await createUser(), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ capacity: 1 }))
        .expect(201)
    ).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    await api().post(`/api/events/${event.id}/registration`).set(b.auth).expect(200);
    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    await settleBackground();
    assert.deepEqual(delivered, [b.user.email]);
  });

  it('sends no email to suspended accounts', async () => {
    const owner = await createUser({ role: 'organizer' });
    const active = await createUser();
    const suspended = await createUser();
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(active.auth).expect(200);
    await api().post(`/api/events/${event.id}/registration`).set(suspended.auth).expect(200);
    suspended.user.status = 'suspended';
    await suspended.user.save();
    await api().post(`/api/events/${event.id}/cancel`).set(owner.auth).send({}).expect(200);
    const recipients = (await OutboxEmail.find({})).map((r) => r.to);
    assert.deepEqual(recipients, [active.user.email]);
  });
});

describe('B12: moving an event re-arms its reminders', () => {
  it('reminds again for the new date, with the real start time', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ startsAt: hoursFromNow(10), endsAt: hoursFromNow(12) }))
        .expect(201)
    ).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);

    assert.equal(await sendDueReminders(), 1);
    const reminder = await Notification.findOne({ user: member.user._id, type: 'event_reminder' });
    assert.match(reminder!.body, /^Starts \w+, \d+ \w+ at .+ IST\.$/);

    // Postponed by a week: the old reminder no longer counts.
    await api()
      .patch(`/api/events/${event.id}`)
      .set(owner.auth)
      .send({ startsAt: hoursFromNow(24 * 7 + 10), endsAt: hoursFromNow(24 * 7 + 12) })
      .expect(200);
    assert.equal((await Registration.findOne({ user: member.user._id }))!.reminderSentAt, null);
    assert.equal(await sendDueReminders(new Date(Date.now() + 24 * 7 * 60 * 60 * 1000)), 1);
  });
});
