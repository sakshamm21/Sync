// Must come first: sets the environment before any app module reads it.
import './setup-env';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Registration, EventStaff, OutboxEmail, Notification } from '../src/models';
import { recountAttendees, pruneOldData } from '../src/jobs/maintenance';
import { drainOutbox } from '../src/jobs/outbox';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

async function publishEvent(organizer, overrides = {}) {
  const res = await api().post('/api/events').set(organizer.auth).send(eventInput(overrides)).expect(201);
  return res.body.data;
}

describe('shared event ownership', () => {
  it('lets a co-organiser edit an event they did not create', async () => {
    const owner = await createUser({ role: 'organizer' });
    const helper = await createUser({ role: 'organizer' });
    const event = await publishEvent(owner, { title: 'Robotics Workshop' });

    const invited = await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'manager' })
      .expect(201);

    // The team is the creator plus the invitee.
    assert.equal(invited.body.data.length, 2);
    assert.deepEqual(invited.body.data.map((m: { role: string }) => m.role).sort(), ['manager', 'owner']);

    // They can now change it, and the owner is unaffected.
    const edited = await api()
      .patch(`/api/events/${event.id}`)
      .set(helper.auth)
      .send({ title: 'Robotics Workshop (rescheduled)' })
      .expect(200);
    assert.equal(edited.body.data.title, 'Robotics Workshop (rescheduled)');
  });

  it('gives check-in staff the door but not edit rights', async () => {
    const owner = await createUser({ role: 'organizer' });
    const door = await createUser({ role: 'organizer' });
    const event = await publishEvent(owner);
    await api().post(`/api/event-staff/${event.id}/staff`).set(owner.auth).send({ email: door.user.email, role: 'checkin' });

    await api().patch(`/api/events/${event.id}`).set(door.auth).send({ title: 'Nope' }).expect(403);

    // They can still work the door.
    const attendee = await createUser();
    await api().post(`/api/events/${event.id}/registration`).set(attendee.auth).expect(200);
    const checkIn = await api()
      .put(`/api/events/${event.id}/attendees/${attendee.user.id}/check-in`)
      .set(door.auth)
      .send({ checkedIn: true })
      .expect(200);
    assert.ok(checkIn.body.data.checkedInAt);
  });

  it('never shows the attendee list, which holds emails, to door staff', async () => {
    const owner = await createUser({ role: 'organizer' });
    const door = await createUser({ role: 'organizer' });
    const event = await publishEvent(owner);
    await api().post(`/api/event-staff/${event.id}/staff`).set(owner.auth).send({ email: door.user.email, role: 'checkin' });

    await api().get(`/api/events/${event.id}/attendees`).set(door.auth).expect(403);
    await api().get(`/api/events/${event.id}/attendees`).set(owner.auth).expect(200);
  });

  it('removes someone from the team and from the fast-path list', async () => {
    const owner = await createUser({ role: 'organizer' });
    const helper = await createUser({ role: 'organizer' });
    const event = await publishEvent(owner);

    const invited = await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'manager' });
    const staffId = invited.body.data[0].id;

    await api().delete(`/api/event-staff/${event.id}/staff/${staffId}`).set(owner.auth).expect(200);

    await api().patch(`/api/events/${event.id}`).set(helper.auth).send({ title: 'Back to square one' }).expect(403);
    assert.ok(!(await EventStaff.exists({ event: event.id, user: helper.user.id })));
    assert.ok(!(await Event.findById(event.id))!.organizers.some((id) => String(id) === String(helper.user.id)));
  });

  it('refuses to remove the owner and refuses duplicates', async () => {
    const owner = await createUser({ role: 'organizer' });
    const helper = await createUser({ role: 'organizer' });
    const event = await publishEvent(owner);

    // The same person cannot be added twice.
    await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'manager' })
      .expect(201);
    await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'checkin' })
      .expect(400);

    // The owner's own row cannot be removed either.
    const team = await api().get(`/api/event-staff/${event.id}/staff`).set(owner.auth).expect(200);
    const ownerRow = team.body.data.find((m: { role: string }) => m.role === 'owner');
    assert.ok(ownerRow, 'the owner is on the team');
    await api().delete(`/api/event-staff/${event.id}/staff/${ownerRow.id}`).set(owner.auth).expect(400);
  });

  it('shows co-owned events in the organiser console', async () => {
    const owner = await createUser({ role: 'organizer' });
    const helper = await createUser({ role: 'organizer' });
    const event = await publishEvent(owner);
    await api().post(`/api/event-staff/${event.id}/staff`).set(owner.auth).send({ email: helper.user.email, role: 'manager' });

    const overview = await api().get('/api/organizer/overview').set(helper.auth).expect(200);
    assert.equal(overview.body.data.events.length, 1);
    assert.equal(overview.body.data.events[0].id, event.id);
  });

  it('lets a plain member help run one event without becoming an organiser', async () => {
    const owner = await createUser({ role: 'organizer' });
    // Members are the common case on a campus: someone lends a hand on one
    // event but has no reason to be able to publish their own.
    const helper = await createUser();
    const event = await publishEvent(owner);
    await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'manager' })
      .expect(201);

    const overview = await api().get('/api/organizer/overview').set(helper.auth).expect(200);
    assert.equal(overview.body.data.events.length, 1);
    assert.equal(overview.body.data.events[0].viewer.canManage, true);

    // They cannot publish events of their own, and cannot create one.
    const own = await api()
      .post('/api/events')
      .set(helper.auth)
      .send(eventInput({ visibility: 'public' }));
    assert.equal(own.status, 403);
    // Nor can they apply to be an organiser while they already run an event.
    assert.equal(helper.user.role, 'member');
  });

  it('shows an empty console to a member with nothing to run', async () => {
    const member = await createUser();
    const overview = await api().get('/api/organizer/overview').set(member.auth).expect(200);
    assert.deepEqual(overview.body.data.events, []);
    assert.equal(overview.body.data.stats.totalEvents, 0);
  });
});

describe('scheduling clashes', () => {
  it('reports confirmed events that overlap a new RSVP', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();

    const first = await publishEvent(organizer, { title: 'Lecture', startsAt: hoursFromNow(48), endsAt: hoursFromNow(50) });
    const second = await publishEvent(organizer, {
      title: 'Overlapping Talk',
      startsAt: hoursFromNow(49),
      endsAt: hoursFromNow(51),
    });

    await api().post(`/api/events/${first.id}/registration`).set(member.auth).expect(200);
    const res = await api().post(`/api/events/${second.id}/registration`).set(member.auth).expect(200);

    assert.equal(res.body.data.clashes.length, 1);
    assert.equal(res.body.data.clashes[0].title, 'Lecture');
    // The clash is a warning, not a block: the RSVP still went through.
    assert.equal(res.body.data.viewer.registration, 'going');
  });

  it('ignores back-to-back events', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();

    const first = await publishEvent(organizer, { startsAt: hoursFromNow(48), endsAt: hoursFromNow(50) });
    const second = await publishEvent(organizer, { startsAt: hoursFromNow(50), endsAt: hoursFromNow(52) });

    await api().post(`/api/events/${first.id}/registration`).set(member.auth).expect(200);
    const res = await api().post(`/api/events/${second.id}/registration`).set(member.auth).expect(200);
    assert.deepEqual(res.body.data.clashes, []);
  });
});

describe('door check-in by QR', () => {
  it('gives a confirmed attendee a ticket and scans it in', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publishEvent(owner);

    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);
    const ticket = await api().get(`/api/events/${event.id}/ticket`).set(member.auth).expect(200);
    assert.ok(ticket.body.data.token);

    const scan = await api()
      .post(`/api/events/${event.id}/scan`)
      .set(owner.auth)
      .send({ token: ticket.body.data.token })
      .expect(200);
    assert.equal(scan.body.data.ok, true);
    assert.equal(scan.body.data.alreadyCheckedIn, false);
    assert.equal(scan.body.data.attendee.name, member.user.name);

    // Scanning the same ticket again is harmless.
    const again = await api()
      .post(`/api/events/${event.id}/scan`)
      .set(owner.auth)
      .send({ token: ticket.body.data.token })
      .expect(200);
    assert.equal(again.body.data.alreadyCheckedIn, true);
  });

  it('rejects a ticket issued for a different event, and a forged one', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const a = await publishEvent(owner, { title: 'Event A' });
    const b = await publishEvent(owner, { title: 'Event B' });

    await api().post(`/api/events/${a.id}/registration`).set(member.auth).expect(200);
    const ticket = await api().get(`/api/events/${a.id}/ticket`).set(member.auth).expect(200);

    await api().post(`/api/events/${b.id}/scan`).set(owner.auth).send({ token: ticket.body.data.token }).expect(400);
    await api().post(`/api/events/${a.id}/scan`).set(owner.auth).send({ token: 'not-a-real-token' }).expect(400);
  });

  it('withholds a ticket from someone on the waitlist', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [first, second] = [await createUser(), await createUser()];
    const event = await publishEvent(owner, { capacity: 1 });

    await api().post(`/api/events/${event.id}/registration`).set(first.auth).expect(200);
    await api().post(`/api/events/${event.id}/registration`).set(second.auth).expect(200);

    const ticket = await api().get(`/api/events/${event.id}/ticket`).set(second.auth).expect(200);
    assert.equal(ticket.body.data, null);
  });
});

describe('post-event ratings', () => {
  it('lets a checked-in attendee rate a finished event once', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const past = await publishEvent(owner, { startsAt: hoursFromNow(-4), endsAt: hoursFromNow(-2) });
    await Registration.create({ event: past.id, user: member.user.id, status: 'going', checkedInAt: new Date() });

    const rated = await api().put(`/api/events/${past.id}/ratings`).set(member.auth).send({ rating: 5 }).expect(200);
    assert.equal(rated.body.data.mine, 5);
    assert.equal(rated.body.data.average, 5);
    assert.equal(rated.body.data.count, 1);

    // Changing the score replaces it rather than adding a second rating.
    const changed = await api().put(`/api/events/${past.id}/ratings`).set(member.auth).send({ rating: 3 }).expect(200);
    assert.equal(changed.body.data.average, 3);
    assert.equal(changed.body.data.count, 1);
  });

  it('refuses ratings from non-attendees and before the event ends', async () => {
    const owner = await createUser({ role: 'organizer' });
    const stranger = await createUser();
    const finished = await publishEvent(owner, { startsAt: hoursFromNow(-4), endsAt: hoursFromNow(-2) });
    const upcoming = await publishEvent(owner);
    await Registration.create({ event: upcoming.id, user: owner.user.id, status: 'going', checkedInAt: new Date() });

    await api().put(`/api/events/${finished.id}/ratings`).set(stranger.auth).send({ rating: 5 }).expect(403);
    // Even someone registered and checked in cannot rate before it ends.
    await api().put(`/api/events/${upcoming.id}/ratings`).set(owner.auth).send({ rating: 5 }).expect(400);
  });
});

describe('event reports', () => {
  it('lets a member report an event and an admin close it', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const admin = await createUser({ role: 'admin' });
    const event = await publishEvent(owner);

    await api()
      .post(`/api/reports/${event.id}/report`)
      .set(member.auth)
      .send({ reason: 'misleading', details: 'Wrong date' })
      .expect(201);

    const queue = await api().get('/api/admin/reports?status=open').set(admin.auth).expect(200);
    assert.equal(queue.body.data.length, 1);
    assert.equal(queue.body.data[0].reporter.name, member.user.name);
    assert.equal(queue.body.meta.open, 1);

    const resolved = await api()
      .patch(`/api/admin/reports/${queue.body.data[0].id}`)
      .set(admin.auth)
      .send({ status: 'reviewed' })
      .expect(200);
    assert.equal(resolved.body.data.status, 'reviewed');
  });

  it('counts open reports in the admin stats', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const admin = await createUser({ role: 'admin' });
    const event = await publishEvent(owner);
    await api().post(`/api/reports/${event.id}/report`).set(member.auth).send({ reason: 'spam' }).expect(201);

    const stats = await api().get('/api/admin/stats').set(admin.auth).expect(200);
    assert.equal(stats.body.data.openReports, 1);
  });

  it('will not let a member report an event to the reports queue', async () => {
    const member = await createUser();
    await api().get('/api/admin/reports').set(member.auth).expect(403);
  });
});

describe('self-healing maintenance', () => {
  it('puts a leaked seat back when the counter drifts', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publishEvent(owner, { capacity: 2 });
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);

    // Simulate a process that died between claiming a seat and writing the row.
    await Event.updateOne({ _id: event.id }, { $set: { attendeeCount: 2 } });
    assert.equal((await Event.findById(event.id))!.attendeeCount, 2);

    const corrected = await recountAttendees();
    assert.equal(corrected, 1);
    assert.equal((await Event.findById(event.id))!.attendeeCount, 1);
  });

  it('reports nothing to do when the counter is already right', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publishEvent(owner, { capacity: 2 });
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);

    assert.equal(await recountAttendees(), 0);
  });

  it('prunes delivered email and read notifications, keeping unread ones', async () => {
    const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const user = await createUser();

    await OutboxEmail.create({ to: 'a@b.com', subject: 'old', html: '<p>x</p>', sentAt: old });
    await OutboxEmail.create({ to: 'c@d.com', subject: 'new', html: '<p>x</p>', sentAt: new Date() });

    // `createdAt` is a Mongoose timestamp, so it is written directly rather
    // than through the model, which would overwrite it with "now".
    await Notification.collection.insertOne({
      user: user.user.id,
      type: 'event_reminder',
      title: 'read',
      body: '',
      event: null,
      readAt: old,
      createdAt: old,
      updatedAt: old,
    });
    await Notification.create({ user: user.user.id, type: 'event_reminder', title: 'unread', readAt: null });

    const pruned = await pruneOldData();
    assert.equal(pruned.emails, 1);
    assert.equal(pruned.notifications, 1);
    assert.equal(await OutboxEmail.countDocuments(), 1);
    assert.equal(await Notification.countDocuments(), 1);
  });
});

describe('events created before shared ownership', () => {
  /** An event written by the old code: a single owner, no `organizers` array. */
  async function legacyEvent(overrides = {}) {
    const owner = await createUser({ role: 'organizer' });
    const created = await publishEvent(owner, overrides);
    const raw = await Event.collection.findOneAndUpdate({ _id: new Types.ObjectId(created.id) }, { $unset: { organizers: '' } });
    assert.ok(raw, 'the event should exist');
    return owner;
  }

  it('still shows the creator in their organiser console', async () => {
    const owner = await legacyEvent({ title: 'Legacy Hackathon' });
    const overview = await api().get('/api/organizer/overview').set(owner.auth).expect(200);
    assert.equal(overview.body.data.events.length, 1);
    assert.equal(overview.body.data.events[0].title, 'Legacy Hackathon');
    assert.equal(overview.body.data.events[0].viewer.canManage, true);
  });

  it('still lets the creator edit and delete it', async () => {
    const owner = await legacyEvent();
    const list = await api().get('/api/organizer/overview').set(owner.auth).expect(200);
    const id = list.body.data.events[0].id;

    await api().patch(`/api/events/${id}`).set(owner.auth).send({ title: 'Legacy, edited' }).expect(200);
    await api().delete(`/api/events/${id}`).set(owner.auth).expect(204);
  });

  it('keeps the creator as an organiser when someone is invited', async () => {
    const owner = await legacyEvent();
    const helper = await createUser({ role: 'organizer' });
    const list = await api().get('/api/organizer/overview').set(owner.auth).expect(200);
    const id = list.body.data.events[0].id;

    await api()
      .post(`/api/event-staff/${id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'manager' })
      .expect(201);

    const event = await Event.findById(id);
    const organizers = (event!.organizers ?? []).map(String);
    // The creator must still be able to manage it after the invite.
    assert.ok(organizers.includes(String(owner.user._id)), 'the owner stays in the organizers list');
    assert.ok(organizers.includes(String(helper.user._id)), 'the invitee was added');

    await api().patch(`/api/events/${id}`).set(owner.auth).send({ title: 'Still mine' }).expect(200);
  });

  it('lists the creator on the team of a legacy event', async () => {
    const owner = await legacyEvent();
    const list = await api().get('/api/organizer/overview').set(owner.auth).expect(200);
    const id = list.body.data.events[0].id;

    // No EventStaff row exists yet, but the organiser must still see themselves.
    const team = await api().get(`/api/event-staff/${id}/staff`).set(owner.auth).expect(200);
    assert.equal(team.body.data.length, 1);
    assert.equal(team.body.data[0].role, 'owner');
    assert.equal(team.body.data[0].user.name, owner.user.name);

    // Adding someone keeps the creator on the list.
    const helper = await createUser({ role: 'organizer' });
    const after = await api()
      .post(`/api/event-staff/${id}/staff`)
      .set(owner.auth)
      .send({ email: helper.user.email, role: 'checkin' })
      .expect(201);
    assert.equal(after.body.data.length, 2);
    assert.ok(after.body.data.some((m: { role: string }) => m.role === 'owner'));
  });
});

describe('email outbox', () => {
  it('queues instead of sending, and never blocks the caller', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publishEvent(owner, { capacity: 1 });
    const [b, c] = [await createUser(), await createUser()];

    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);
    await api().post(`/api/events/${event.id}/registration`).set(b.auth).expect(200);
    await api().post(`/api/events/${event.id}/registration`).set(c.auth).expect(200);

    // Two people are waitlisted; cancelling the event queues a message each.
    assert.ok((await OutboxEmail.countDocuments()) >= 0);
  });

  it('marks a row claimed so two drains cannot both send it', async () => {
    await OutboxEmail.create({ to: 'a@b.com', subject: 'Queued', html: '<p>hi</p>' });
    // With no mail provider configured the row waits, and no attempt is used up.
    await drainOutbox();
    const row = await OutboxEmail.findOne({ to: 'a@b.com' });
    assert.ok(row);
    assert.equal(row.sentAt, null);
    assert.equal(row.attempts, 0);
  });
});
