// Roadmap "Now" #1: Web Push for reminders, waitlist moves and announcements.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { PushSubscription } from '../src/models';
import { setTestPushSender } from '../src/lib/push';
import { settleBackground } from '../src/lib/background';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);
afterEach(async () => {
  await settleBackground();
  setTestPushSender(null);
});

const device = (n = 1) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: 'BPk', auth: 'auth' } });

describe('push notifications', () => {
  it('registers a device once and pushes notifications to it', async () => {
    const pushed: { endpoint: string; payload: Record<string, string> }[] = [];
    setTestPushSender(async (sub, payload) => {
      pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    await api().post('/api/me/push-subscriptions').set(member.auth).send(device()).expect(201);
    await api().post('/api/me/push-subscriptions').set(member.auth).send(device()).expect(201);
    assert.equal(await PushSubscription.countDocuments(), 1);

    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);
    await api().post(`/api/events/${event.id}/cancel`).set(owner.auth).send({}).expect(200);
    await settleBackground();

    assert.equal(pushed.length, 1);
    assert.match(pushed[0].payload.title, /^Cancelled:/);
    assert.equal(pushed[0].payload.url, `/events/${event.id}`);
  });

  it('forgets devices the push service says are gone', async () => {
    setTestPushSender(async () => {
      throw Object.assign(new Error('Gone'), { statusCode: 410 });
    });
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    await api().post('/api/me/push-subscriptions').set(member.auth).send(device(2)).expect(201);
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);
    await api().post(`/api/events/${event.id}/cancel`).set(owner.auth).send({}).expect(200);
    await settleBackground();
    assert.equal(await PushSubscription.countDocuments(), 0);
  });

  it('only accepts https push endpoints, and lets a device opt out', async () => {
    const member = await createUser();
    await api()
      .post('/api/me/push-subscriptions')
      .set(member.auth)
      .send({ ...device(), endpoint: 'http://evil.test/x' })
      .expect(400);
    await api().post('/api/me/push-subscriptions').set(member.auth).send(device(3)).expect(201);
    await api()
      .post('/api/me/push-subscriptions/remove')
      .set(member.auth)
      .send({ endpoint: device(3).endpoint })
      .expect(200);
    assert.equal(await PushSubscription.countDocuments(), 0);
  });
});
