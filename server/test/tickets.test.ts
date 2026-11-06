// Regression tests for door tickets and session tokens (docs/IMPROVEMENT_PLAN.md, PR 5).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event } from '../src/models';
import env from '../src/config/env';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

type Actor = Awaited<ReturnType<typeof createUser>>;

async function setUp(overrides = {}) {
  const owner = await createUser({ role: 'organizer' });
  const member = await createUser();
  const event = (await api().post('/api/events').set(owner.auth).send(eventInput(overrides)).expect(201)).body.data;
  await api().post(`/api/events/${event.id}/registration`).set(member.auth).expect(200);
  const token: string = (await api().get(`/api/events/${event.id}/ticket`).set(member.auth).expect(200)).body.data.token;
  return { owner, member, event, token };
}

const scan = (eventId: string, who: Actor, token: string) => api().post(`/api/events/${eventId}/scan`).set(who.auth).send({ token });

describe('B1: tickets are short enough to scan', () => {
  it('fits in a small QR code', async () => {
    const { token } = await setUp();
    assert.ok(token.length <= 45, `ticket is ${token.length} characters`);
    assert.match(token, /^t1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  });

  it('rejects a ticket with a tampered signature', async () => {
    const { owner, event, token } = await setUp();
    const forged = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    const res = await scan(event.id, owner, forged).expect(400);
    assert.equal(res.body.error.code, 'BAD_TICKET');
  });

  it('door staff can scan; strangers get 403', async () => {
    const { owner, event, token } = await setUp();
    const door = await createUser();
    await api().post(`/api/event-staff/${event.id}/staff`).set(owner.auth).send({ email: door.user.email, role: 'checkin' }).expect(201);
    const res = await scan(event.id, door, token).expect(200);
    assert.equal(res.body.data.alreadyCheckedIn, false);
    await scan(event.id, await createUser(), token).expect(403);
  });
});

describe('B29: scans are refused when the event is off or long over', () => {
  it('refuses a cancelled event', async () => {
    const { owner, event, token } = await setUp();
    await api().post(`/api/events/${event.id}/cancel`).set(owner.auth).send({}).expect(200);
    assert.equal((await scan(event.id, owner, token).expect(400)).body.error.code, 'EVENT_CANCELLED');
  });

  it('refuses more than six hours after the end, allows late check-in before that', async () => {
    const { owner, event, token } = await setUp();
    await Event.updateOne({ _id: event.id }, { $set: { startsAt: new Date(hoursFromNow(-4)), endsAt: new Date(hoursFromNow(-2)) } });
    await scan(event.id, owner, token).expect(200);
    await Event.updateOne({ _id: event.id }, { $set: { startsAt: new Date(hoursFromNow(-9)), endsAt: new Date(hoursFromNow(-7)) } });
    assert.equal((await scan(event.id, owner, token).expect(400)).body.error.code, 'EVENT_ENDED');
  });
});

describe('B42: session tokens', () => {
  it('rejects an unsigned token', async () => {
    const { user } = await createUser();
    const none = jwt.sign({ sub: String(user._id), role: 'admin' }, '', { algorithm: 'none' });
    await api().get('/api/me').set({ Authorization: `Bearer ${none}` }).expect(401);
  });

  it('rejects a token made for another purpose', async () => {
    const { user } = await createUser();
    const other = jwt.sign({ sub: String(user._id), role: 'member' }, env.jwtSecret, { audience: 'ticket' });
    await api().get('/api/me').set({ Authorization: `Bearer ${other}` }).expect(401);
  });

  it('still accepts sessions signed before audiences existed', async () => {
    const { user } = await createUser();
    const legacy = jwt.sign({ sub: String(user._id), role: 'member' }, env.jwtSecret);
    await api().get('/api/me').set({ Authorization: `Bearer ${legacy}` }).expect(200);
  });
});
