// Roadmap "Next" #7: friends, and seeing which friends are going.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('friends', () => {
  it('needs both sides to agree before plans are shared', async () => {
    const owner = await createUser({ role: 'organizer' });
    const kabir = await createUser({ name: 'Kabir' });
    const aanya = await createUser({ name: 'Aanya', email: 'aanya@example.com' });
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(aanya.auth).expect(200);

    // An unknown address gets the same answer (no account probing).
    await api().post('/api/friends/requests').set(kabir.auth).send({ email: 'nobody@example.com' }).expect(201);
    await api().post('/api/friends/requests').set(kabir.auth).send({ email: 'aanya@example.com' }).expect(201);
    let view = (await api().get(`/api/events/${event.id}`).set(kabir.auth).expect(200)).body.data;
    assert.deepEqual(view.viewer.friendsGoing, { names: [], count: 0 }, 'not friends until accepted');

    const incoming = (await api().get('/api/friends').set(aanya.auth).expect(200)).body.data.incoming;
    assert.equal(incoming[0].user.name, 'Kabir');
    await api().put(`/api/friends/requests/${incoming[0].id}`).set(aanya.auth).send({ accept: true }).expect(200);

    view = (await api().get(`/api/events/${event.id}`).set(kabir.auth).expect(200)).body.data;
    assert.deepEqual(view.viewer.friendsGoing, { names: ['Aanya'], count: 1 });
    const list = (await api().get('/api/events').set(kabir.auth).expect(200)).body.data;
    assert.equal(list[0].viewer.friendsGoing.count, 1);

    await api().delete(`/api/friends/${aanya.user.id}`).set(kabir.auth).expect(200);
    view = (await api().get(`/api/events/${event.id}`).set(kabir.auth).expect(200)).body.data;
    assert.equal(view.viewer.friendsGoing.count, 0);
  });
});
