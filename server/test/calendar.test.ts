// Roadmap "Now" #3 and #6: a calendar subscription that stays in sync, and
// the waitlist position.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('calendar subscription', () => {
  it('serves the events you are going to and run, and follows changes', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const going = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ title: 'Robotics Night' }))
        .expect(201)
    ).body.data;
    await api()
      .post('/api/events')
      .set(owner.auth)
      .send(eventInput({ title: 'Not my thing' }))
      .expect(201);
    await api().post(`/api/events/${going.id}/registration`).set(member.auth).expect(200);
    const plan = (
      await api()
        .post('/api/events')
        .set(member.auth)
        .send(eventInput({ title: 'Gym', visibility: 'private' }))
        .expect(201)
    ).body.data;

    const { url, webcalUrl } = (await api().get('/api/me/calendar-feed').set(member.auth).expect(200)).body.data;
    assert.match(webcalUrl, /^webcal:/);
    const path = new URL(url).pathname;

    // No session needed: calendar apps only have the URL.
    let feed = (
      await api()
        .get(path)
        .expect(200)
        .expect('content-type', /text\/calendar/)
    ).text;
    assert.match(feed, /X-WR-CALNAME:Sync/);
    assert.match(feed, /SUMMARY:Robotics Night/);
    assert.match(feed, /SUMMARY:Gym/);
    assert.doesNotMatch(feed, /Not my thing/);
    assert.ok(plan.id);

    await api().post(`/api/events/${going.id}/cancel`).set(owner.auth).send({}).expect(200);
    feed = (await api().get(path).expect(200)).text;
    assert.match(feed, /SUMMARY:Robotics Night[\s\S]*?STATUS:CANCELLED/);
  });

  it('stops working once the link is reset', async () => {
    const member = await createUser();
    const first = new URL((await api().get('/api/me/calendar-feed').set(member.auth)).body.data.url).pathname;
    const second = new URL((await api().post('/api/me/calendar-feed/reset').set(member.auth).expect(200)).body.data.url).pathname;
    assert.notEqual(first, second);
    await api().get(first).expect(404);
    await api().get(second).expect(200);
  });
});

describe('waitlist position', () => {
  it('tells each waiting person where they are in line', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ capacity: 1, startsAt: hoursFromNow(30), endsAt: hoursFromNow(32) }))
        .expect(201)
    ).body.data;
    for (const who of [a, b, c]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
    const view = async (who: typeof a) => (await api().get(`/api/events/${event.id}`).set(who.auth).expect(200)).body.data.viewer;
    assert.equal((await view(a)).waitlistPosition, undefined);
    assert.equal((await view(b)).waitlistPosition, 1);
    assert.equal((await view(c)).waitlistPosition, 2);
  });
});
