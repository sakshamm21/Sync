// Regression tests for permission and data-integrity holes found in review
// (docs/IMPROVEMENT_PLAN.md, PR 2). Each block names the bug it covers.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Notification, Registration } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

type Actor = Awaited<ReturnType<typeof createUser>>;

async function publish(organizer: Actor, overrides = {}) {
  return (await api().post('/api/events').set(organizer.auth).send(eventInput(overrides)).expect(201)).body.data;
}

async function addToTeam(owner: Actor, eventId: string, member: Actor, role: 'manager' | 'checkin') {
  const team = (
    await api().post(`/api/event-staff/${eventId}/staff`).set(owner.auth).send({ email: member.user.email, role }).expect(201)
  ).body.data;
  return team as { id: string; role: string; user: { id: string } }[];
}

describe('B4: the event owner keeps their event', () => {
  it("refuses any change to the owner's place on the team", async () => {
    const owner = await createUser({ role: 'organizer' });
    const manager = await createUser({ role: 'organizer' });
    const event = await publish(owner);
    const team = await addToTeam(owner, event.id, manager, 'manager');
    const ownerRow = team.find((m) => m.role === 'owner')!;
    const managerRow = team.find((m) => m.role === 'manager')!;

    const demote = await api()
      .patch(`/api/event-staff/${event.id}/staff/${ownerRow.id}`)
      .set(manager.auth)
      .send({ role: 'checkin' })
      .expect(400);
    assert.equal(demote.body.error.code, 'OWNER_PROTECTED');
    await api().delete(`/api/event-staff/${event.id}/staff/${ownerRow.id}`).set(manager.auth).expect(400);
    // Even the owner can't remove themselves by accident.
    await api().delete(`/api/event-staff/${event.id}/staff/${ownerRow.id}`).set(owner.auth).expect(400);
    // Nobody can be made owner through a role change.
    await api().patch(`/api/event-staff/${event.id}/staff/${managerRow.id}`).set(owner.auth).send({ role: 'owner' }).expect(400);

    const mine = await api().get(`/api/events/${event.id}`).set(owner.auth).expect(200);
    assert.equal(mine.body.data.viewer.canManage, true);
    await api().patch(`/api/events/${event.id}`).set(owner.auth).send({ title: 'Still mine' }).expect(200);
  });

  it('lets only the owner add, remove or change co-organisers', async () => {
    const owner = await createUser({ role: 'organizer' });
    const manager = await createUser({ role: 'organizer' });
    const other = await createUser({ role: 'organizer' });
    const door = await createUser();
    const event = await publish(owner);
    await addToTeam(owner, event.id, manager, 'manager');

    const invite = await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(manager.auth)
      .send({ email: other.user.email, role: 'manager' })
      .expect(403);
    assert.equal(invite.body.error.code, 'OWNER_ONLY');

    // Door staff are a co-organiser's call.
    const team = (
      await api()
        .post(`/api/event-staff/${event.id}/staff`)
        .set(manager.auth)
        .send({ email: door.user.email, role: 'checkin' })
        .expect(201)
    ).body.data;
    const doorRow = team.find((m: { user: { id: string } }) => m.user.id === door.user.id);
    await api().patch(`/api/event-staff/${event.id}/staff/${doorRow.id}`).set(manager.auth).send({ role: 'manager' }).expect(403);
    await api().delete(`/api/event-staff/${event.id}/staff/${doorRow.id}`).set(manager.auth).expect(200);

    const managerRow = team.find((m: { user: { id: string } }) => m.user.id === manager.user.id);
    await api().delete(`/api/event-staff/${event.id}/staff/${managerRow.id}`).set(owner.auth).expect(200);
  });

  it('lets only the owner delete the event', async () => {
    const owner = await createUser({ role: 'organizer' });
    const manager = await createUser({ role: 'organizer' });
    const event = await publish(owner);
    await addToTeam(owner, event.id, manager, 'manager');
    await api().delete(`/api/events/${event.id}`).set(manager.auth).expect(403);
    await api().delete(`/api/events/${event.id}`).set(owner.auth).expect(204);
  });
});

describe('B5: door staff work the door only', () => {
  it('may chat but may not send announcements', async () => {
    const owner = await createUser({ role: 'organizer' });
    const door = await createUser();
    const attendee = await createUser();
    const event = await publish(owner);
    await addToTeam(owner, event.id, door, 'checkin');
    await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);

    await api()
      .post(`/api/events/${event.id}/messages`)
      .set(door.auth)
      .send({ text: 'Free pizza!', announcement: true })
      .expect(403);
    assert.equal(await Notification.exists({ user: attendee.user._id, type: 'announcement' }), null);
    await api().post(`/api/events/${event.id}/messages`).set(door.auth).send({ text: 'Doors open at 6' }).expect(201);
  });

  it('can see a draft their team is preparing, but not edit it', async () => {
    const owner = await createUser({ role: 'organizer' });
    const door = await createUser();
    const event = await publish(owner, { status: 'draft' });
    await addToTeam(owner, event.id, door, 'checkin');
    const res = await api().get(`/api/events/${event.id}`).set(door.auth).expect(200);
    assert.equal(res.body.data.viewer.canManage, false);
    assert.equal(res.body.data.viewer.canCheckIn, true);
    await api().patch(`/api/events/${event.id}`).set(door.auth).send({ title: 'Nope' }).expect(403);
  });
});

describe('B3: the door list', () => {
  it('gives door staff names and check-ins, never email addresses', async () => {
    const owner = await createUser({ role: 'organizer' });
    const door = await createUser();
    const attendee = await createUser({ name: 'Zara Khan' });
    const outsider = await createUser();
    const event = await publish(owner);
    await addToTeam(owner, event.id, door, 'checkin');
    await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);

    const res = await api().get(`/api/events/${event.id}/door-list`).set(door.auth).expect(200);
    assert.equal(res.body.data.counts.going, 1);
    assert.equal(res.body.data.items[0].user.name, 'Zara Khan');
    assert.ok(!JSON.stringify(res.body.data).includes(attendee.user.email), 'no email addresses');

    await api()
      .put(`/api/events/${event.id}/attendees/${attendee.user.id}/check-in`)
      .set(door.auth)
      .send({ checkedIn: true })
      .expect(200);
    const after = await api().get(`/api/events/${event.id}/door-list`).set(door.auth).expect(200);
    assert.equal(after.body.data.counts.checkedIn, 1);

    await api().get(`/api/events/${event.id}/attendees`).set(door.auth).expect(403);
    await api().get(`/api/events/${event.id}/door-list`).set(outsider.auth).expect(403);
  });
});

describe('B10: cancelling a reported event', () => {
  it('tells the attendees and the organiser, with the reason', async () => {
    const owner = await createUser({ role: 'organizer' });
    const admin = await createUser({ role: 'admin' });
    const attendee = await createUser();
    const event = await publish(owner);
    await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);
    await api().post(`/api/reports/${event.id}/report`).set(attendee.auth).send({ reason: 'spam' }).expect(201);

    const queue = await api().get('/api/admin/reports').set(admin.auth).expect(200);
    await api()
      .patch(`/api/admin/reports/${queue.body.data[0].id}`)
      .set(admin.auth)
      .send({ status: 'reviewed', reason: 'Not a real event' })
      .expect(200);

    assert.equal((await Event.findById(event.id))!.status, 'cancelled');
    const told = await Notification.findOne({ user: attendee.user._id, type: 'event_cancelled' });
    assert.equal(told?.body, 'Not a real event');
    const ownerTold = await Notification.findOne({ user: owner.user._id, type: 'event_cancelled' });
    assert.match(ownerTold!.body, /Not a real event/);
  });
});

describe('B11: publishing and unpublishing', () => {
  it('refuses to turn an event with registrations back into a draft', async () => {
    const owner = await createUser({ role: 'organizer' });
    const attendee = await createUser();
    const event = await publish(owner);
    await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);
    const res = await api().patch(`/api/events/${event.id}`).set(owner.auth).send({ status: 'draft' }).expect(400);
    assert.equal(res.body.error.code, 'HAS_REGISTRATIONS');
    await api().get(`/api/events/${event.id}`).set(attendee.auth).expect(200);
  });

  it('still lets an event nobody has joined go back to draft', async () => {
    const owner = await createUser({ role: 'organizer' });
    const event = await publish(owner);
    await api().patch(`/api/events/${event.id}`).set(owner.auth).send({ status: 'draft' }).expect(200);
  });

  it('refuses drafts and capacity on personal events, and publishing an event that has ended', async () => {
    const member = await createUser();
    const owner = await createUser({ role: 'organizer' });
    const plan = (await api().post('/api/events').set(member.auth).send(eventInput()).expect(201)).body.data;
    await api().patch(`/api/events/${plan.id}`).set(member.auth).send({ status: 'draft' }).expect(400);
    await api().patch(`/api/events/${plan.id}`).set(member.auth).send({ capacity: 10 }).expect(400);

    const draft = await publish(owner, { status: 'draft', startsAt: hoursFromNow(-3), endsAt: hoursFromNow(-2) });
    const res = await api().patch(`/api/events/${draft.id}`).set(owner.auth).send({ status: 'published' }).expect(400);
    assert.equal(res.body.error.code, 'EVENT_ENDED');
  });
});

describe('B16: links must be web addresses', () => {
  it('refuses javascript: and data: URLs', async () => {
    const owner = await createUser({ role: 'organizer' });
    await api()
      .post('/api/events')
      .set(owner.auth)
      .send(eventInput({ onlineUrl: 'javascript:alert(1)' }))
      .expect(400);
    await api()
      .post('/api/events')
      .set(owner.auth)
      .send(eventInput({ coverImageUrl: 'data:image/svg+xml,<svg/>' }))
      .expect(400);
    await api().patch('/api/me').set(owner.auth).send({ avatarUrl: 'javascript:alert(1)' }).expect(400);
    await api()
      .post('/api/events')
      .set(owner.auth)
      .send(eventInput({ onlineUrl: 'https://meet.example.com/abc' }))
      .expect(201);
  });
});

describe('B17: suspended accounts get no session', () => {
  it('from a password reset', async () => {
    const { user } = await createUser({ status: 'suspended' });
    const requested = await api().post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    const token = new URL(requested.body.data.devResetUrl).searchParams.get('token');
    const res = await api().post('/api/auth/reset-password').send({ token, password: 'newpassword123' }).expect(403);
    assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
    assert.equal(res.body.data, undefined);
  });
});

describe('B18: attendance history stays', () => {
  it('refuses leaving an event that has started', async () => {
    const owner = await createUser({ role: 'organizer' });
    const attendee = await createUser();
    const event = await publish(owner, { startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) });
    await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);
    await Event.updateOne({ _id: event.id }, { startsAt: new Date(Date.now() - 60_000) });

    const res = await api().delete(`/api/events/${event.id}/registration`).set(attendee.auth).expect(400);
    assert.equal(res.body.error.code, 'EVENT_STARTED');
    assert.ok(await Registration.exists({ event: event.id, user: attendee.user._id }));
  });

  it('still allows leaving before it starts', async () => {
    const owner = await createUser({ role: 'organizer' });
    const attendee = await createUser();
    const event = await publish(owner);
    await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);
    await api().delete(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);
  });
});

describe('B21: clashes', () => {
  it('ignore events that were cancelled', async () => {
    const owner = await createUser({ role: 'organizer' });
    const attendee = await createUser();
    const first = await publish(owner, { title: 'Alpha', startsAt: hoursFromNow(48), endsAt: hoursFromNow(50) });
    const second = await publish(owner, { title: 'Bravo', startsAt: hoursFromNow(49), endsAt: hoursFromNow(51) });
    await api().post(`/api/events/${first.id}/registration`).set(attendee.auth).expect(200);
    await api().post(`/api/events/${first.id}/cancel`).set(owner.auth).send({}).expect(200);
    const res = await api().post(`/api/events/${second.id}/registration`).set(attendee.auth).expect(200);
    assert.deepEqual(res.body.data.clashes, []);
  });
});
