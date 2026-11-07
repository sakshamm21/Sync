// Roadmap "Next" #3: recurring events.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Event, Registration } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('repeating events', () => {
  it('creates a weekly series and lets members RSVP to one date or all of them', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const first = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ title: 'Coding Club', capacity: 20, repeat: { every: 'week', count: 4 } }))
        .expect(201)
    ).body.data;

    const dates = await Event.find({ seriesId: first.seriesId }).sort({ startsAt: 1 });
    assert.equal(dates.length, 4);
    const week = 7 * 24 * 60 * 60 * 1000;
    assert.equal(dates[3].startsAt.getTime() - dates[0].startsAt.getTime(), 3 * week);
    assert.ok(dates.every((d) => d.title === 'Coding Club' && d.capacity === 20 && d.attendeeCount === 0));

    const series = (await api().get(`/api/events/${first.id}/series`).expect(200)).body.data;
    assert.equal(series.length, 4);

    const results = (await api().post(`/api/events/${first.id}/registration/series`).set(member.auth).expect(200)).body.data;
    assert.deepEqual(
      results.map((r: { status: string }) => r.status),
      ['going', 'going', 'going', 'going']
    );
    assert.equal(await Registration.countDocuments({ user: member.user._id }), 4);
  });

  it('refuses a series RSVP on a one-off event', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const one = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    assert.equal(one.seriesId, null);
    await api().post(`/api/events/${one.id}/registration/series`).set(member.auth).expect(400);
  });
});
