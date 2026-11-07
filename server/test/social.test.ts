// Roadmap "Next" #7 (invite a friend), #5 (album link), #11 (remind me before).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Notification, Reminder } from '../src/models';
import { sendPersonalReminders } from '../src/modules/events/social.service';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

async function befriend(a: Awaited<ReturnType<typeof createUser>>, b: Awaited<ReturnType<typeof createUser>>) {
  await api().post('/api/friends/requests').set(a.auth).send({ email: b.user.email }).expect(201);
  const incoming = (await api().get('/api/friends').set(b.auth)).body.data.incoming;
  await api().put(`/api/friends/requests/${incoming[0].id}`).set(b.auth).send({ accept: true }).expect(200);
}

describe('inviting friends', () => {
  it('only reaches friends, and skips ones already going', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [me, friend, stranger] = [await createUser({ name: 'Kabir' }), await createUser(), await createUser()];
    await befriend(me, friend);
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ title: 'Jam Night' }))
        .expect(201)
    ).body.data;

    await api()
      .post(`/api/events/${event.id}/invite`)
      .set(me.auth)
      .send({ friends: [stranger.user.id] })
      .expect(403);
    const res = (
      await api()
        .post(`/api/events/${event.id}/invite`)
        .set(me.auth)
        .send({ friends: [friend.user.id] })
        .expect(200)
    ).body.data;
    assert.deepEqual(res, { invited: 1, alreadyGoing: 0 });
    const note = await Notification.findOne({ user: friend.user._id, type: 'event_invite' });
    assert.equal(note!.title, 'Kabir invited you to Jam Night');
  });
});

describe('personal reminders and albums', () => {
  it('sends a reminder at the chosen time, once', async () => {
    const owner = await createUser({ role: 'organizer' });
    const me = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ startsAt: hoursFromNow(3), endsAt: hoursFromNow(5) }))
        .expect(201)
    ).body.data;
    await api().put(`/api/events/${event.id}/reminder`).set(me.auth).send({ minutesBefore: 60 }).expect(200);
    assert.deepEqual((await api().get(`/api/events/${event.id}/reminder`).set(me.auth)).body.data, { minutesBefore: 60 });
    await api().put(`/api/events/${event.id}/reminder`).set(me.auth).send({ minutesBefore: 1440 }).expect(400); // already past

    assert.equal(await sendPersonalReminders(), 0, 'not yet');
    assert.equal(await sendPersonalReminders(new Date(Date.now() + 2.1 * 3600_000)), 1);
    assert.equal(await sendPersonalReminders(new Date(Date.now() + 2.2 * 3600_000)), 0, 'only once');
    assert.ok(await Notification.exists({ user: me.user._id, title: /^Soon:/ }));
    assert.ok((await Reminder.findOne({ user: me.user._id }))!.sentAt);
  });

  it('lets organisers add a photo album link (https only)', async () => {
    const owner = await createUser({ role: 'organizer' });
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().patch(`/api/events/${event.id}`).set(owner.auth).send({ albumUrl: 'javascript:alert(1)' }).expect(400);
    const updated = (
      await api()
        .patch(`/api/events/${event.id}`)
        .set(owner.auth)
        .send({ albumUrl: 'https://photos.example.com/jam' })
        .expect(200)
    ).body.data;
    assert.equal(updated.albumUrl, 'https://photos.example.com/jam');
  });
});
