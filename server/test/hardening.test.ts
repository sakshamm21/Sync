// Regression tests for the remaining P2 fixes (docs/IMPROVEMENT_PLAN.md, PR 8).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Notification, Registration, User } from '../src/models';
import { runTool } from '../src/modules/assistant/assistant.tools';
import { MongoRateLimitStore } from '../src/middleware/rateLimitStore';
import { emailDomainAllowed } from '../src/modules/auth/auth.service';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

type Actor = Awaited<ReturnType<typeof createUser>>;
const publish = async (who: Actor, overrides = {}) =>
  (await api().post('/api/events').set(who.auth).send(eventInput(overrides)).expect(201)).body.data;

/** Moves an event into the past, keeping its registrations. */
const endEvent = (id: string) =>
  Event.updateOne({ _id: id }, { $set: { startsAt: new Date(hoursFromNow(-5)), endsAt: new Date(hoursFromNow(-3)) } });

describe('B28: only checked-in attendees rate, and the numbers agree', () => {
  it('refuses someone who RSVPed but never came; accepts someone checked in', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [came, noShow] = [await createUser(), await createUser()];
    const event = await publish(owner);
    for (const who of [came, noShow]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
    await api()
      .put(`/api/events/${event.id}/attendees/${came.user.id}/check-in`)
      .set(owner.auth)
      .send({ checkedIn: true })
      .expect(200);
    await endEvent(event.id);

    await api().put(`/api/events/${event.id}/ratings`).set(noShow.auth).send({ rating: 1 }).expect(403);
    const res = await api().put(`/api/events/${event.id}/ratings`).set(came.auth).send({ rating: 4 }).expect(200);
    assert.equal(res.body.data.average, 4);
    assert.equal(res.body.data.count, 1);
  });
});

describe('B30: recommendations', () => {
  it('never suggests an event you help run, and prefers organisers with good ratings', async () => {
    const good = await createUser({ role: 'organizer' });
    const poor = await createUser({ role: 'organizer' });
    const member = await createUser();
    // Track records: good's past event scored 5, poor's scored 1.
    for (const [org, score] of [
      [good, 5],
      [poor, 1],
    ] as const) {
      const past = await publish(org, { title: `Past by ${org.user.name}` });
      await Event.updateOne(
        { _id: past.id },
        { $set: { startsAt: new Date(hoursFromNow(-50)), endsAt: new Date(hoursFromNow(-48)), ratingSum: score, ratingCount: 1 } }
      );
    }
    const fromPoor = await publish(poor, { title: 'Poorly run thing' });
    const fromGood = await publish(good, { title: 'Well run thing' });
    const helping = await publish(good, { title: 'Something I help with' });
    await api()
      .post(`/api/event-staff/${helping.id}/staff`)
      .set(good.auth)
      .send({ email: member.user.email, role: 'checkin' })
      .expect(201);

    const ids = (await api().get('/api/events/recommended').set(member.auth).expect(200)).body.data.map(
      (e: { id: string }) => e.id
    );
    assert.ok(!ids.includes(helping.id));
    assert.ok(ids.indexOf(fromGood.id) < ids.indexOf(fromPoor.id));
  });
});

describe('B31: the organizer filter includes co-organisers', () => {
  it("lists an event under a co-organiser's name", async () => {
    const owner = await createUser({ role: 'organizer' });
    const helper = await createUser({ role: 'organizer' });
    const event = await publish(owner);
    await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'manager' })
      .expect(201);
    const res = await api().get('/api/events').query({ organizer: helper.user.id }).expect(200);
    assert.deepEqual(
      res.body.data.map((e: { id: string }) => e.id),
      [event.id]
    );
  });
});

describe('B33: deleting events', () => {
  it('refuses to delete an event that has happened', async () => {
    const owner = await createUser({ role: 'organizer' });
    const event = await publish(owner);
    await endEvent(event.id);
    assert.equal((await api().delete(`/api/events/${event.id}`).set(owner.auth).expect(400)).body.error.code, 'EVENT_STARTED');
  });

  it('keeps notifications but unlinks them from a deleted event', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publish(owner);
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);
    await api().delete(`/api/events/${event.id}`).set(owner.auth).expect(204);
    const notes = await Notification.find({ user: member.user._id });
    assert.ok(notes.length >= 1);
    assert.ok(notes.every((n) => n.event === null));
    assert.equal(await Registration.countDocuments({ event: event.id }), 0);
  });
});

describe('B35: the assistant ignores inherited tool names', () => {
  it('returns an error rather than crashing on "constructor"', async () => {
    const { user } = await createUser();
    const result = await runTool(
      { id: '1', type: 'function', function: { name: 'constructor', arguments: '{}' } } as never,
      { user } as never
    );
    assert.deepEqual(result, { error: 'Unknown tool "constructor"' });
  });
});

describe('B36: sign-in and password reset', () => {
  it('sends at most one reset email a minute', async () => {
    const { user } = await createUser();
    const first = await api().post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    assert.ok(first.body.data.devResetUrl);
    const second = await api().post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    assert.equal(second.body.data.devResetUrl, undefined);
  });

  it('rejects unknown emails the same way as wrong passwords', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever123' }).expect(401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });
});

describe('B45: sign out of all devices', () => {
  it('refuses every token issued before', async () => {
    const actor = await createUser();
    await User.updateOne({ _id: actor.user._id }, { $set: { sessionsRevokedAt: new Date(Date.now() + 2000) } });
    await api().get('/api/me').set(actor.auth).expect(401);
  });

  it('is available from the API', async () => {
    const actor = await createUser();
    await api().post('/api/me/sign-out-everywhere').set(actor.auth).expect(200);
    const saved = await User.findById(actor.user._id).select('+sessionsRevokedAt');
    assert.ok(saved!.sessionsRevokedAt);
  });
});

describe('B19: shared rate-limit counts', () => {
  it('counts across store instances and starts a new window when one ends', async () => {
    const a = new MongoRateLimitStore('t:');
    const b = new MongoRateLimitStore('t:');
    a.init({ windowMs: 60_000 } as never);
    b.init({ windowMs: 60_000 } as never);
    assert.equal((await a.increment('ip')).totalHits, 1);
    assert.equal((await b.increment('ip')).totalHits, 2);
    await b.decrement('ip');
    assert.equal((await a.get('ip'))?.totalHits, 1);
    await a.resetKey('ip');
    assert.equal(await a.get('ip'), undefined);
  });
});

describe('Roadmap #12: campus-only sign-up', () => {
  it('matches the domain and its subdomains, and allows anyone when unset', async () => {
    const campus = ['iitk.ac.in'];
    assert.equal(emailDomainAllowed('a@iitk.ac.in', campus), true);
    assert.equal(emailDomainAllowed('a@cse.iitk.ac.in', campus), true);
    assert.equal(emailDomainAllowed('a@gmail.com', campus), false);
    assert.equal(emailDomainAllowed('a@notiitk.ac.in', campus), false);
    assert.equal(emailDomainAllowed('a@gmail.com', []), true);
  });
});
