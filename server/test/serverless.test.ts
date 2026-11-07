// Serverless (Vercel) behaviour: polling mode, cron endpoint, wildcard CORS.
import './serverless.env';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Notification } from '../src/models';
import handler from '../api';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('serverless deployment support', () => {
  it('tells the client to poll', async () => {
    const res = await api().get('/api/meta').expect(200);
    assert.deepEqual(res.body.data, {
      realtime: 'polling',
      emailDelivery: false,
      assistant: false,
      demo: false,
      allowedEmailDomains: [],
      pushPublicKey: null,
    });
  });

  it('runs reminders only for callers with the cron secret', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(organizer.auth)
        .send(eventInput({ startsAt: hoursFromNow(2), endsAt: hoursFromNow(3) }))
    ).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(member.auth);

    await api().get('/api/jobs/event-reminders').expect(403);
    await api().get('/api/jobs/event-reminders').set('Authorization', 'Bearer wrong').expect(403);
    const res = await api().get('/api/jobs/event-reminders').set('Authorization', 'Bearer test-cron-secret').expect(200);
    assert.equal(res.body.data.sent, 1);
    assert.equal((await Notification.findOne({ user: member.user._id }))!.type, 'event_reminder');
  });

  it('refuses the demo reset unless DEMO_MODE is on', async () => {
    const res = await api().get('/api/jobs/demo-reset').set('Authorization', 'Bearer test-cron-secret').expect(404);
    assert.equal(res.body.error.code, 'DEMO_MODE_OFF');
  });

  it('returns only newer chat messages when polling with `after`', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (await api().post('/api/events').set(organizer.auth).send(eventInput())).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(member.auth);

    const first = (await api().post(`/api/events/${event.id}/messages`).set(member.auth).send({ text: 'one' })).body.data;
    await api().post(`/api/events/${event.id}/messages`).set(organizer.auth).send({ text: 'two' });

    const res = await api()
      .get(`/api/events/${event.id}/messages`)
      .query({ after: first.createdAt })
      .set(member.auth)
      .expect(200);
    assert.deepEqual(
      res.body.data.map((m) => m.text),
      ['two']
    );
  });

  it('allows preview deployment origins that match a wildcard', async () => {
    const ok = await api().get('/api/meta').set('Origin', 'https://sync-git-feature-sak.vercel.app');
    assert.equal(ok.headers['access-control-allow-origin'], 'https://sync-git-feature-sak.vercel.app');
    const blocked = await api().get('/api/meta').set('Origin', 'https://sync-x.evil.app');
    assert.equal(blocked.headers['access-control-allow-origin'], undefined);
  });

  it('serves requests through the Vercel handler', async () => {
    const res = await supertest(handler).get('/api/health').expect(200);
    assert.equal(res.body.data.database, 'up');
  });
});
