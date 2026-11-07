// Roadmap "Now" #6: a fair, visible waitlist with a claim window.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Event, Notification, Registration } from '../src/models';
import { expireOffers } from '../src/modules/events/waitlist.service';
import { recountAttendees } from '../src/jobs/maintenance';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

type Actor = Awaited<ReturnType<typeof createUser>>;
const statusOf = async (eventId: string, who: Actor) =>
  (await Registration.findOne({ event: eventId, user: who.user._id }))?.status;

async function fullEventWithQueue(claimHours: number | null) {
  const owner = await createUser({ role: 'organizer' });
  const [a, b, c] = [await createUser(), await createUser(), await createUser()];
  const event = (
    await api()
      .post('/api/events')
      .set(owner.auth)
      .send(eventInput({ capacity: 1, waitlistClaimHours: claimHours }))
      .expect(201)
  ).body.data;
  for (const who of [a, b, c]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
  return { owner, a, b, c, event };
}

describe('waitlist claim window', () => {
  it('offers the freed seat; claiming it confirms the place', async () => {
    const { a, b, c, event } = await fullEventWithQueue(12);
    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    assert.equal(await statusOf(event.id, b), 'offered');
    assert.ok(await Notification.exists({ user: b.user._id, type: 'waitlist_offer' }));
    // The held seat still counts, so nobody else slips in.
    assert.equal((await Event.findById(event.id))!.attendeeCount, 1);
    assert.equal(await recountAttendees(), 0);

    const claimed = (await api().post(`/api/events/${event.id}/registration/claim`).set(b.auth).expect(200)).body.data;
    assert.equal(claimed.viewer.registration, 'going');
    await api().post(`/api/events/${event.id}/registration/claim`).set(c.auth).expect(400);
  });

  it('passes an unclaimed offer to the next person when it expires', async () => {
    const { a, b, c, event } = await fullEventWithQueue(12);
    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    await Registration.updateOne(
      { event: event.id, user: b.user._id },
      { $set: { offerExpiresAt: new Date(Date.now() - 1000) } }
    );

    assert.equal(await expireOffers(), 1);
    assert.equal(await statusOf(event.id, b), undefined);
    assert.equal(await statusOf(event.id, c), 'offered');
    assert.ok(await Notification.exists({ user: b.user._id, title: /^Offer expired/ }));
  });

  it('declining an offer passes it on straight away', async () => {
    const { a, b, c, event } = await fullEventWithQueue(6);
    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    await api().delete(`/api/events/${event.id}/registration`).set(b.auth).expect(200);
    assert.equal(await statusOf(event.id, c), 'offered');
  });

  it('"take any seat automatically" skips the claim step', async () => {
    const { a, b, event } = await fullEventWithQueue(12);
    await api()
      .patch('/api/me')
      .set(b.auth)
      .send({ preferences: { autoAcceptWaitlist: true } })
      .expect(200);
    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    assert.equal(await statusOf(event.id, b), 'going');
  });

  it('events without a claim window keep moving people in automatically', async () => {
    const { a, b, event } = await fullEventWithQueue(null);
    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    assert.equal(await statusOf(event.id, b), 'going');
  });
});
