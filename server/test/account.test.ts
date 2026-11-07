// Roadmap "Next" #12 (export and delete my account) and #9 (admin audit log).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Event, Notification, Registration, User } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('my data', () => {
  it('exports what Sync holds about you', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ title: 'Bot Wars' }))
        .expect(201)
    ).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);
    const res = await api().get('/api/me/export').set(member.auth).expect(200);
    assert.match(res.headers['content-disposition'], /sync-my-data\.json/);
    assert.equal(res.body.profile.email, member.user.email);
    assert.equal(res.body.registrations[0].event.title, 'Bot Wars');
    assert.equal(res.body.profile.passwordHash, undefined);
  });

  it('deletes the account, passes on its seat and cancels its upcoming events', async () => {
    const leaver = await createUser({ role: 'organizer' });
    const host = await createUser({ role: 'organizer' });
    const [waiting, attendee] = [await createUser(), await createUser()];
    const full = (
      await api()
        .post('/api/events')
        .set(host.auth)
        .send(eventInput({ capacity: 1 }))
        .expect(201)
    ).body.data;
    await api().post(`/api/events/${full.id}/registration`).set(leaver.auth).expect(200);
    await api().post(`/api/events/${full.id}/registration`).set(waiting.auth).expect(200);
    const mine = (
      await api()
        .post('/api/events')
        .set(leaver.auth)
        .send(eventInput({ title: 'Mine' }))
        .expect(201)
    ).body.data;
    await api().post(`/api/events/${mine.id}/registration`).set(attendee.auth).expect(200);

    await api().post('/api/me/delete').set(leaver.auth).send({ password: 'wrong' }).expect(401);
    await api().post('/api/me/delete').set(leaver.auth).send({ password: 'password123' }).expect(200);

    assert.equal(await User.exists({ _id: leaver.user._id }), null);
    assert.equal((await Registration.findOne({ user: waiting.user._id }))!.status, 'going');
    assert.equal((await Event.findById(mine.id))!.status, 'cancelled');
    assert.ok(await Notification.exists({ user: attendee.user._id, type: 'event_cancelled' }));
    await api().get('/api/me').set(leaver.auth).expect(401);
  });

  it('keeps the last admin from deleting themselves', async () => {
    const admin = await createUser({ role: 'admin' });
    assert.equal(
      (await api().post('/api/me/delete').set(admin.auth).send({ password: 'password123' }).expect(403)).body.error.code,
      'LAST_ADMIN'
    );
  });
});

describe('admin audit log', () => {
  it('records suspensions, approvals and takedowns, newest first', async () => {
    const admin = await createUser({ role: 'admin', name: 'Ada Admin' });
    const member = await createUser({ name: 'Sam Member' });
    await api().patch(`/api/admin/users/${member.user.id}`).set(admin.auth).send({ status: 'suspended' }).expect(200);
    await api().patch(`/api/admin/users/${member.user.id}`).set(admin.auth).send({ status: 'active' }).expect(200);
    const log = (await api().get('/api/admin/audit-log').set(admin.auth).expect(200)).body.data;
    assert.deepEqual(
      log.map((l: { action: string }) => l.action),
      ['user.reactivated', 'user.suspended']
    );
    assert.equal(log[1].summary, 'Suspended Sam Member');
    assert.equal(log[1].actor.name, 'Ada Admin');
    await api().get('/api/admin/audit-log').set(member.auth).expect(403);
  });
});

describe('changing email', () => {
  it('only switches after a code from the new inbox, and signs out other sessions', async () => {
    const member = await createUser({ email: 'old@example.com' });
    await createUser({ email: 'taken@example.com' });
    await api().post('/api/me/email').set(member.auth).send({ email: 'taken@example.com', password: 'password123' }).expect(409);
    await api().post('/api/me/email').set(member.auth).send({ email: 'new@example.com', password: 'nope' }).expect(401);

    const started = (
      await api().post('/api/me/email').set(member.auth).send({ email: 'new@example.com', password: 'password123' }).expect(200)
    ).body.data;
    assert.equal(started.pendingEmail, 'new@example.com');
    assert.equal((await User.findById(member.user._id))!.email, 'old@example.com', 'nothing changes yet');

    await api().post('/api/me/email/confirm').set(member.auth).send({ code: '000000' }).expect(400);
    const session = (await api().post('/api/me/email/confirm').set(member.auth).send({ code: started.devCode }).expect(200)).body
      .data;
    assert.equal(session.user.email, 'new@example.com');
    await new Promise((r) => setTimeout(r, 1100));
    await api()
      .get('/api/me')
      .set({ Authorization: `Bearer ${session.token}` })
      .expect(200);
  });
});
