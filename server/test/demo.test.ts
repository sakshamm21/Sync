// Public demo mode: the nightly reset and the guards on shared demo accounts.
import './demo.env';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Event, User } from '../src/models';
import { at, seed } from '../src/demo/seed';
import * as data from '../src/demo/data';

const cron = { Authorization: 'Bearer test-cron-secret' };

async function signIn(email: string) {
  const res = await api().post('/api/auth/login').send({ email, password: data.DEMO_PASSWORD }).expect(200);
  return { Authorization: `Bearer ${res.body.data.token}` };
}

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('demo dates', () => {
  it('places events on the campus clock, whatever the server time zone', () => {
    // 2026-11-06 22:00 UTC is already 7 Nov 03:30 in India.
    const now = new Date('2026-11-06T22:00:00Z');
    assert.equal(at({ day: 0, hour: 18 }, now, 'Asia/Kolkata').toISOString(), '2026-11-07T12:30:00.000Z');
    assert.equal(at({ day: 1, hour: 9, minute: 30 }, now, 'Asia/Kolkata').toISOString(), '2026-11-08T04:00:00.000Z');
    assert.equal(at({ day: 0, hour: 18 }, now, 'UTC').toISOString(), '2026-11-06T18:00:00.000Z');
  });
});

describe('nightly demo reset', () => {
  it('needs the cron secret', async () => {
    await api().get('/api/jobs/demo-reset').expect(403);
  });

  it('replaces everything with fresh demo data that has upcoming events', async () => {
    const vandal = await createUser({ role: 'organizer' });
    await api().post('/api/events').set(vandal.auth).send(eventInput({ title: 'ASDFGHJ' })).expect(201);

    const res = await api().get('/api/jobs/demo-reset').set(cron).expect(200);
    assert.equal(res.body.data.users, data.users.length);

    assert.equal(await Event.exists({ title: 'ASDFGHJ' }), null);
    assert.equal(await User.exists({ _id: vandal.user._id }), null);
    const upcoming = await api().get('/api/events').expect(200);
    assert.ok(upcoming.body.meta.total > 0, 'the demo should always have upcoming events');
  });

  it('lets only one reset run at a time, so two never wipe each other', async () => {
    const [first, second] = await Promise.all([
      api().get('/api/jobs/demo-reset').set(cron),
      api().get('/api/jobs/demo-reset').set(cron),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    assert.equal([first, second].find((r) => r.status === 409)!.body.error.code, 'RESET_IN_PROGRESS');

    // Exactly one copy of the data, and the next reset can run.
    assert.equal(await Event.countDocuments(), data.events.length);
    assert.equal(await Event.countDocuments({ title: 'Tech Summit 2026' }), 1);
    await api().get('/api/jobs/demo-reset').set(cron).expect(200);
  });

  it('reports demo mode to the web app', async () => {
    const res = await api().get('/api/meta').expect(200);
    assert.equal(res.body.data.demo, true);
  });
});

describe('shared demo accounts', () => {
  beforeEach(async () => {
    await seed();
  });

  it('cannot have their password changed or reset', async () => {
    const auth = await signIn('member@syncronify.dev');
    const change = await api()
      .post('/api/me/password')
      .set(auth)
      .send({ currentPassword: data.DEMO_PASSWORD, newPassword: 'locked-you-out' })
      .expect(403);
    assert.equal(change.body.error.code, 'DEMO_ACCOUNT');

    const reset = await api().post('/api/auth/forgot-password').send({ email: 'member@syncronify.dev' }).expect(403);
    assert.equal(reset.body.error.code, 'DEMO_ACCOUNT');

    // The password still works for the next visitor.
    await signIn('member@syncronify.dev');
  });

  it('cannot be suspended or demoted by the demo admin', async () => {
    const auth = await signIn('admin@syncronify.dev');
    const organizer = await User.findOne({ email: 'organizer@syncronify.dev' });
    const res = await api().patch(`/api/admin/users/${organizer!.id}`).set(auth).send({ status: 'suspended' }).expect(403);
    assert.equal(res.body.error.code, 'DEMO_ACCOUNT');
    assert.equal((await User.findById(organizer!._id))!.status, 'active');
  });

  it('leaves accounts people made themselves alone', async () => {
    const own = await createUser({ password: 'my-own-password' });
    await api()
      .post('/api/me/password')
      .set(own.auth)
      .send({ currentPassword: 'my-own-password', newPassword: 'a-new-password' })
      .expect(200);

    const auth = await signIn('admin@syncronify.dev');
    await api().patch(`/api/admin/users/${own.user.id}`).set(auth).send({ status: 'suspended' }).expect(200);
  });
});
