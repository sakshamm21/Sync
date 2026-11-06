// Roadmap "Now" #4 (Interested) and #8 (notification centre and per-type email).
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Notification, OutboxEmail } from '../src/models';
import { sendDueReminders } from '../src/jobs/eventReminders';
import { settleBackground } from '../src/lib/background';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);
afterEach(settleBackground);

describe('Interested', () => {
  it('counts bookmarks once, shows them to the viewer, and takes no seat', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ capacity: 1 }))
        .expect(201)
    ).body.data;

    const marked = (await api().put(`/api/events/${event.id}/interest`).set(member.auth).expect(200)).body.data;
    await api().put(`/api/events/${event.id}/interest`).set(member.auth).expect(200);
    assert.equal(marked.viewer.interested, true);
    assert.equal(marked.interestedCount, 1);
    assert.equal((await Event.findById(event.id))!.interestedCount, 1);
    assert.equal(marked.attendeeCount, 0);

    const unmarked = (await api().delete(`/api/events/${event.id}/interest`).set(member.auth).expect(200)).body.data;
    assert.equal(unmarked.viewer.interested, false);
    assert.equal(unmarked.interestedCount, 0);
  });

  it('nudges interested people in the app the day before, without email', async () => {
    const owner = await createUser({ role: 'organizer' });
    const curious = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ startsAt: hoursFromNow(10), endsAt: hoursFromNow(12) }))
        .expect(201)
    ).body.data;
    await api().put(`/api/events/${event.id}/interest`).set(curious.auth).expect(200);

    assert.equal(await sendDueReminders(), 1);
    const note = await Notification.findOne({ user: curious.user._id });
    assert.match(note!.title, /^Still interested\?/);
    assert.equal(await OutboxEmail.countDocuments({ to: curious.user.email }), 0);
    assert.equal(await sendDueReminders(), 0, 'only once');
  });
});

describe('notification centre', () => {
  it('filters by type, and muted types stay out of email', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);

    await api()
      .patch('/api/me')
      .set(member.auth)
      .send({ preferences: { mutedEmailTypes: ['announcement'] } })
      .expect(200);
    await api()
      .post(`/api/events/${event.id}/messages`)
      .set(owner.auth)
      .send({ text: 'Doors at 6', announcement: true })
      .expect(201);
    await api().post(`/api/events/${event.id}/cancel`).set(owner.auth).send({}).expect(200);

    const emailed = (await OutboxEmail.find({ to: member.user.email })).map((r) => r.subject);
    assert.equal(emailed.length, 1, 'the cancellation is emailed, the announcement is not');

    const announcements = (await api().get('/api/notifications?type=announcement').set(member.auth).expect(200)).body.data;
    assert.equal(announcements.length, 1);
    assert.equal(announcements[0].type, 'announcement');
  });
});
