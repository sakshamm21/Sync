// Regression tests for seat handover and the waitlist (docs/IMPROVEMENT_PLAN.md, PR 3).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Notification, Registration } from '../src/models';
import { recountAttendees } from '../src/jobs/maintenance';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

type Actor = Awaited<ReturnType<typeof createUser>>;

async function publish(organizer: Actor, overrides = {}) {
  return (await api().post('/api/events').set(organizer.auth).send(eventInput(overrides)).expect(201)).body.data;
}

const rsvp = (eventId: string, who: Actor) => api().post(`/api/events/${eventId}/registration`).set(who.auth).expect(200);
const statusOf = async (eventId: string, who: Actor) =>
  (await Registration.findOne({ event: eventId, user: who.user._id }))?.status;

describe('B8: a freed seat goes to the waitlist', () => {
  it('hands the seat to the first person waiting before the response returns', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const event = await publish(owner, { capacity: 1 });

    await rsvp(event.id, a);
    await rsvp(event.id, b);
    assert.equal(await statusOf(event.id, b), 'waitlisted');

    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    // No waiting on background work: B already holds the seat.
    assert.equal(await statusOf(event.id, b), 'going');
    assert.ok(await Notification.exists({ user: b.user._id, type: 'waitlist_promoted' }));
    assert.equal((await Event.findById(event.id))!.attendeeCount, 1);

    // A fresh RSVP can't take the seat that was just handed over.
    await rsvp(event.id, c);
    assert.equal(await statusOf(event.id, c), 'waitlisted');
  });

  it('does not let a new RSVP jump the queue when a seat looks free', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const event = await publish(owner, { capacity: 1 });
    await rsvp(event.id, a);
    await rsvp(event.id, b);

    // A seat leaks (a process died mid-way): the counter says one is free.
    await Event.updateOne({ _id: event.id }, { $set: { attendeeCount: 0 } });
    await rsvp(event.id, c);
    assert.equal(await statusOf(event.id, c), 'waitlisted');
  });

  it('frees the seat when nobody is waiting', async () => {
    const owner = await createUser({ role: 'organizer' });
    const a = await createUser();
    const event = await publish(owner, { capacity: 1 });
    await rsvp(event.id, a);
    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    assert.equal((await Event.findById(event.id))!.attendeeCount, 0);
  });
});

describe('B8/B23: the maintenance recount', () => {
  it('promotes the waitlist after correcting a leaked seat', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b] = [await createUser(), await createUser()];
    const event = await publish(owner, { capacity: 2 });
    await rsvp(event.id, a);
    // B ended up waiting although a seat is free (a lost promotion).
    await Event.updateOne({ _id: event.id }, { $set: { attendeeCount: 2 } });
    await rsvp(event.id, b);
    assert.equal(await statusOf(event.id, b), 'waitlisted');

    assert.equal(await recountAttendees(), 1);
    assert.equal(await statusOf(event.id, b), 'going');
    assert.equal((await Event.findById(event.id))!.attendeeCount, 2);
  });

  it('leaves finished events alone', async () => {
    const owner = await createUser({ role: 'organizer' });
    const event = await publish(owner, { capacity: 5 });
    await Event.updateOne(
      { _id: event.id },
      { $set: { attendeeCount: 3, startsAt: new Date(hoursFromNow(-5)), endsAt: new Date(hoursFromNow(-3)) } }
    );
    assert.equal(await recountAttendees(), 0);
    assert.equal((await Event.findById(event.id))!.attendeeCount, 3);
  });

  it('checks every capped event, not just the first page', async () => {
    const owner = await createUser({ role: 'organizer' });
    const base = eventInput({ capacity: 10 });
    const owned = owner.user._id;
    await Event.insertMany(
      Array.from({ length: 450 }, (_, i) => ({
        ...base,
        title: `Event ${i}`,
        startsAt: new Date(base.startsAt as string),
        endsAt: new Date(base.endsAt as string),
        owner: owned,
        organizers: [owned],
        visibility: 'public',
        status: 'published',
        attendeeCount: 1,
      }))
    );
    assert.equal(await recountAttendees(), 450);
    assert.equal(await Event.countDocuments({ attendeeCount: { $ne: 0 } }), 0);
  });
});
