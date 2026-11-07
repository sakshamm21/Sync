// Roadmap "Now" #10: registration windows and targeted announcements.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Notification } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('registration window', () => {
  it('refuses RSVPs before it opens and after it closes, with a clear reason', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ registrationOpensAt: hoursFromNow(5), registrationClosesAt: hoursFromNow(20) }))
        .expect(201)
    ).body.data;

    const early = await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(400);
    assert.equal(early.body.error.code, 'REGISTRATION_NOT_OPEN');
    assert.match(early.body.error.message, /^Registration opens \w+, /);

    await Event.updateOne({ _id: event.id }, { $set: { registrationOpensAt: new Date(hoursFromNow(-1)) } });
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);

    await Event.updateOne({ _id: event.id }, { $set: { registrationClosesAt: new Date(hoursFromNow(-0.5)) } });
    const late = await api()
      .post(`/api/events/${event.id}/registration`)
      .set((await createUser()).auth)
      .expect(400);
    assert.equal(late.body.error.code, 'REGISTRATION_CLOSED');
  });

  it('rejects a window that closes before it opens', async () => {
    const owner = await createUser({ role: 'organizer' });
    await api()
      .post('/api/events')
      .set(owner.auth)
      .send(eventInput({ registrationOpensAt: hoursFromNow(10), registrationClosesAt: hoursFromNow(5) }))
      .expect(400);
  });
});

describe('announcement audience', () => {
  it('can reach only the people going, or only the waitlist', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [going, waiting] = [await createUser(), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ capacity: 1 }))
        .expect(201)
    ).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(going.auth).expect(200);
    await api().post(`/api/events/${event.id}/registration`).set(waiting.auth).expect(200);

    const say = (text: string, audience: string) =>
      api().post(`/api/events/${event.id}/messages`).set(owner.auth).send({ text, announcement: true, audience }).expect(201);
    await say('Doors at 6', 'going');
    await say('A few spots may open', 'waitlisted');

    const bodies = async (who: typeof going) =>
      (await Notification.find({ user: who.user._id, type: 'announcement' })).map((n) => n.body);
    assert.deepEqual(await bodies(going), ['Doors at 6']);
    assert.deepEqual(await bodies(waiting), ['A few spots may open']);
  });
});

describe('Roadmap Next #8: room clashes', () => {
  it('warns when the same venue is booked at an overlapping time, but still saves', async () => {
    const [a, b] = [await createUser({ role: 'organizer' }), await createUser({ role: 'organizer' })];
    const first = (
      await api()
        .post('/api/events')
        .set(a.auth)
        .send(
          eventInput({ title: 'Robotics Demo', venue: { name: 'LHC 101' }, startsAt: hoursFromNow(48), endsAt: hoursFromNow(50) })
        )
        .expect(201)
    ).body.data;
    assert.deepEqual(first.venueClashes, []);

    const second = (
      await api()
        .post('/api/events')
        .set(b.auth)
        .send(eventInput({ title: 'Quiz', venue: { name: 'lhc 101' }, startsAt: hoursFromNow(49), endsAt: hoursFromNow(51) }))
        .expect(201)
    ).body.data;
    assert.deepEqual(
      second.venueClashes.map((c: { title: string }) => c.title),
      ['Robotics Demo']
    );

    // Moving it to a free slot clears the warning.
    const moved = (
      await api()
        .patch(`/api/events/${second.id}`)
        .set(b.auth)
        .send({ startsAt: hoursFromNow(52), endsAt: hoursFromNow(54) })
        .expect(200)
    ).body.data;
    assert.deepEqual(moved.venueClashes, []);
  });
});
