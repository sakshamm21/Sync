// Roadmap "Now" #2: find the right event faster.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

const titles = (res: { body: { data: { title: string }[] } }) => res.body.data.map((e) => e.title).sort();

describe('Explore filters', () => {
  it('filters by free seats, online and tag, and finds events by club name', async () => {
    const club = await createUser({ role: 'organizer', organization: 'Robotics Club' });
    const other = await createUser({ role: 'organizer', organization: 'Drama Society' });
    const member = await createUser();
    const full = (
      await api()
        .post('/api/events')
        .set(club.auth)
        .send(eventInput({ title: 'Full Workshop', capacity: 1 }))
        .expect(201)
    ).body.data;
    await api().post(`/api/events/${full.id}/registration`).set(member.auth).expect(200);
    await api()
      .post('/api/events')
      .set(club.auth)
      .send(eventInput({ title: 'Open Lab', capacity: 30, tags: ['free-food'] }))
      .expect(201);
    await api()
      .post('/api/events')
      .set(other.auth)
      .send(eventInput({ title: 'Online Reading', onlineUrl: 'https://meet.example.com/x' }))
      .expect(201);

    assert.deepEqual(titles(await api().get('/api/events?hasSpots=true')), ['Online Reading', 'Open Lab']);
    assert.deepEqual(titles(await api().get('/api/events?online=true')), ['Online Reading']);
    assert.deepEqual(titles(await api().get('/api/events?tag=free-food')), ['Open Lab']);
    assert.deepEqual(titles(await api().get('/api/events?q=robotics')), ['Full Workshop', 'Open Lab']);
  });
});
