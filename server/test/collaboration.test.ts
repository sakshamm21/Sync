import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Notification, Registration, Event } from '../src/models';
import { sendDueReminders } from '../src/jobs/eventReminders';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

async function eventWithAttendee(overrides = {}) {
  const organizer = await createUser({ role: 'organizer' });
  const attendee = await createUser();
  const event = (await api().post('/api/events').set(organizer.auth).send(eventInput(overrides))).body.data;
  await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);
  return { organizer, attendee, event };
}

describe('event discussion', () => {
  it('is open to the organiser and attendees only', async () => {
    const { organizer, attendee, event } = await eventWithAttendee();
    const outsider = await createUser();

    await api().post(`/api/events/${event.id}/messages`).set(attendee.auth).send({ text: 'Is there parking?' }).expect(201);
    await api().post(`/api/events/${event.id}/messages`).set(organizer.auth).send({ text: 'Lot B is open.' }).expect(201);

    const res = await api().get(`/api/events/${event.id}/messages`).set(attendee.auth).expect(200);
    assert.deepEqual(
      res.body.data.map((m) => m.text),
      ['Is there parking?', 'Lot B is open.']
    );
    assert.equal(res.body.data[1].sender.role, 'organizer');

    const denied = await api().get(`/api/events/${event.id}/messages`).set(outsider.auth).expect(403);
    assert.equal(denied.body.error.code, 'CHAT_FORBIDDEN');
  });

  it('paginates older messages with a cursor', async () => {
    const { attendee, event } = await eventWithAttendee();
    for (let i = 1; i <= 5; i += 1) {
      await api()
        .post(`/api/events/${event.id}/messages`)
        .set(attendee.auth)
        .send({ text: `m${i}` });
    }
    const latest = await api().get(`/api/events/${event.id}/messages?limit=2`).set(attendee.auth).expect(200);
    assert.deepEqual(
      latest.body.data.map((m) => m.text),
      ['m4', 'm5']
    );
    assert.equal(latest.body.meta.hasMore, true);

    const older = await api()
      .get(`/api/events/${event.id}/messages`)
      .query({ limit: 10, before: latest.body.data[0].createdAt })
      .set(attendee.auth)
      .expect(200);
    assert.deepEqual(
      older.body.data.map((m) => m.text),
      ['m1', 'm2', 'm3']
    );
  });

  it('lets only the organiser post announcements, which notify attendees', async () => {
    const { organizer, attendee, event } = await eventWithAttendee();

    await api().post(`/api/events/${event.id}/messages`).set(attendee.auth).send({ text: 'Hi', announcement: true }).expect(403);
    await api()
      .post(`/api/events/${event.id}/messages`)
      .set(organizer.auth)
      .send({ text: 'Doors open at 9!', announcement: true })
      .expect(201);

    const notification = await Notification.findOne({ user: attendee.user._id });
    assert.equal(notification!.type, 'announcement');
    assert.equal(notification!.body, 'Doors open at 9!');
    assert.equal(await Notification.countDocuments({ user: organizer.user._id }), 0);
  });
});

describe('notifications', () => {
  it('counts unread items and marks them read', async () => {
    const { organizer, attendee, event } = await eventWithAttendee();
    for (const text of ['one', 'two']) {
      await api().post(`/api/events/${event.id}/messages`).set(organizer.auth).send({ text, announcement: true });
    }

    const unread = async () => (await api().get('/api/notifications').set(attendee.auth).expect(200)).body.meta.unread;
    assert.equal(await unread(), 2);

    const list = await api().get('/api/notifications').set(attendee.auth).expect(200);
    await api().post(`/api/notifications/${list.body.data[0].id}/read`).set(attendee.auth).expect(200);
    assert.equal(await unread(), 1);

    await api().post('/api/notifications/read-all').set(attendee.auth).expect(200);
    assert.equal(await unread(), 0);
  });

  it("does not let users read someone else's notifications", async () => {
    const { organizer, attendee, event } = await eventWithAttendee();
    await api().post(`/api/events/${event.id}/messages`).set(organizer.auth).send({ text: 'x', announcement: true });
    const [notification] = (await api().get('/api/notifications').set(attendee.auth)).body.data;
    await api().post(`/api/notifications/${notification.id}/read`).set(organizer.auth).expect(404);
  });
});

describe('event reminders', () => {
  it('reminds confirmed attendees once, within 24 hours of the start', async () => {
    const { attendee, event } = await eventWithAttendee({ startsAt: hoursFromNow(3), endsAt: hoursFromNow(4), capacity: 1 });
    const waitlisted = await createUser();
    await api().post(`/api/events/${event.id}/registration`).set(waitlisted.auth);
    const { event: farAway } = await eventWithAttendee({ startsAt: hoursFromNow(72), endsAt: hoursFromNow(73) });

    assert.equal(await sendDueReminders(), 1);
    assert.equal(await sendDueReminders(), 0, 'does not send twice');

    const reminder = await Notification.findOne({ user: attendee.user._id });
    assert.equal(reminder!.type, 'event_reminder');
    assert.match(reminder!.body, /^Starts .+ IST\.$/);
    assert.equal(await Notification.countDocuments({ user: waitlisted.user._id }), 0);
    assert.equal((await Registration.findOne({ event: farAway.id }))!.reminderSentAt, null);
    assert.ok(await Event.findById(event.id));
  });
});

describe('notes', () => {
  it('supports create, search, pin, update and delete', async () => {
    const member = await createUser();
    const created = await api()
      .post('/api/notes')
      .set(member.auth)
      .send({ title: 'Catering checklist', content: 'Vegan boxes for 45', tag: 'logistics' })
      .expect(201);
    await api().post('/api/notes').set(member.auth).send({ title: 'Speaker agenda', tag: 'speaker' }).expect(201);

    const pinned = await api().patch(`/api/notes/${created.body.data.id}`).set(member.auth).send({ pinned: true }).expect(200);
    assert.equal(pinned.body.data.pinned, true);

    const list = await api().get('/api/notes').set(member.auth).expect(200);
    assert.equal(list.body.data[0].title, 'Catering checklist', 'pinned notes come first');

    const search = await api().get('/api/notes?q=vegan').set(member.auth).expect(200);
    assert.equal(search.body.data.length, 1);
    const byTag = await api().get('/api/notes?tag=speaker').set(member.auth).expect(200);
    assert.equal(byTag.body.data[0].title, 'Speaker agenda');

    await api().delete(`/api/notes/${created.body.data.id}`).set(member.auth).expect(204);
    assert.equal((await api().get('/api/notes').set(member.auth)).body.meta.total, 1);
  });

  it("keeps each user's notes private", async () => {
    const owner = await createUser();
    const other = await createUser();
    const note = (await api().post('/api/notes').set(owner.auth).send({ title: 'Mine' })).body.data;

    assert.equal((await api().get('/api/notes').set(other.auth)).body.data.length, 0);
    await api().patch(`/api/notes/${note.id}`).set(other.auth).send({ title: 'Stolen' }).expect(404);
    await api().delete(`/api/notes/${note.id}`).set(other.auth).expect(404);
  });

  it("cannot be linked to an event the user can't see", async () => {
    const owner = await createUser();
    const other = await createUser();
    const privateEvent = (await api().post('/api/events').set(other.auth).send(eventInput())).body.data;
    await api().post('/api/notes').set(owner.auth).send({ title: 'Snooping', event: privateEvent.id }).expect(404);
  });
});
