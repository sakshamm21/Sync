// Roadmap "Next" #8 (campus venues) and #9 (review of a new organiser's first event).
import './review.env';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Notification } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('first-event review', () => {
  it("holds a new organiser's first public event until an admin approves it", async () => {
    const admin = await createUser({ role: 'admin' });
    const organiser = await createUser({ role: 'organizer' });
    const first = (
      await api()
        .post('/api/events')
        .set(organiser.auth)
        .send(eventInput({ title: 'Debut Night' }))
        .expect(201)
    ).body.data;
    assert.equal(first.status, 'draft');
    assert.equal(first.awaitingReview, true);
    assert.ok(await Notification.exists({ user: admin.user._id, title: /^First event to review/ }));
    const blocked = await api().patch(`/api/events/${first.id}`).set(organiser.auth).send({ status: 'published' }).expect(403);
    assert.equal(blocked.body.error.code, 'AWAITING_REVIEW');

    const queue = (await api().get('/api/admin/event-reviews').set(admin.auth).expect(200)).body.data;
    assert.deepEqual(
      queue.map((e: { title: string }) => e.title),
      ['Debut Night']
    );
    await api().post(`/api/admin/event-reviews/${first.id}`).set(admin.auth).send({ approve: true }).expect(200);
    assert.equal((await api().get(`/api/events/${first.id}`).expect(200)).body.data.status, 'published');

    // Their next event goes straight out.
    const second = (
      await api()
        .post('/api/events')
        .set(organiser.auth)
        .send(eventInput({ title: 'Encore' }))
        .expect(201)
    ).body.data;
    assert.equal(second.status, 'published');
  });
});

describe('campus venues', () => {
  it('admins keep the list; organisers are warned when the room is too small', async () => {
    const admin = await createUser({ role: 'admin' });
    const organiser = await createUser({ role: 'organizer' });
    await api().post('/api/venues').set(organiser.auth).send({ name: 'LHC 101', latitude: 26.5, longitude: 80.2 }).expect(403);
    await api()
      .post('/api/venues')
      .set(admin.auth)
      .send({ name: 'LHC 101', latitude: 26.5, longitude: 80.2, capacity: 50 })
      .expect(201);
    await api().post('/api/venues').set(admin.auth).send({ name: 'lhc 101', latitude: 26.5, longitude: 80.2 }).expect(409);
    assert.equal((await api().get('/api/venues').set(organiser.auth).expect(200)).body.data.length, 1);

    // (Admins skip first-event review.)
    const big = (
      await api()
        .post('/api/events')
        .set(admin.auth)
        .send(eventInput({ capacity: 120, venue: { name: 'LHC 101' } }))
        .expect(201)
    ).body.data;
    assert.match(big.venueClashes[0].title, /holds 50, fewer than this event's 120/);
  });
});
