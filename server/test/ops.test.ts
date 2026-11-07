// Roadmap "Later" #6: volunteer shifts, sponsors and event budgets.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('club operations', () => {
  it('runs shifts for the event team, a managers-only budget, and sponsors on the club page', async () => {
    const club = await createUser({ role: 'organizer' });
    const door = await createUser();
    const stranger = await createUser();
    const event = (await api().post('/api/events').set(club.auth).send(eventInput()).expect(201)).body.data;
    await api()
      .post(`/api/event-staff/${event.id}/staff`)
      .set(club.auth)
      .send({ email: door.user.email, role: 'checkin' })
      .expect(201);

    const shifts = (
      await api()
        .post(`/api/ops/events/${event.id}/shifts`)
        .set(club.auth)
        .send({ title: 'Registration desk', startsAt: hoursFromNow(47), endsAt: hoursFromNow(49), slots: 1 })
        .expect(201)
    ).body.data;
    await api()
      .put(`/api/ops/events/${event.id}/shifts/${shifts[0].id}/volunteer`)
      .set(stranger.auth)
      .send({ join: true })
      .expect(403);
    const joined = (
      await api()
        .put(`/api/ops/events/${event.id}/shifts/${shifts[0].id}/volunteer`)
        .set(door.auth)
        .send({ join: true })
        .expect(200)
    ).body.data;
    assert.equal(joined[0].volunteers.length, 1);
    const full = await api()
      .put(`/api/ops/events/${event.id}/shifts/${shifts[0].id}/volunteer`)
      .set(club.auth)
      .send({ join: true })
      .expect(400);
    assert.equal(full.body.error.code, 'SHIFT_FULL');

    await api()
      .post(`/api/ops/events/${event.id}/budget`)
      .set(club.auth)
      .send({ label: 'Sponsor grant', amount: 5000, kind: 'income' })
      .expect(201);
    const budget = (
      await api()
        .post(`/api/ops/events/${event.id}/budget`)
        .set(club.auth)
        .send({ label: 'Pizza', amount: 1800, kind: 'expense' })
        .expect(201)
    ).body.data;
    assert.deepEqual([budget.income, budget.expense, budget.balance], [5000, 1800, 3200]);
    await api().get(`/api/ops/events/${event.id}/budget`).set(door.auth).expect(403);

    await api()
      .post('/api/ops/sponsors')
      .set(club.auth)
      .send({ name: 'Acme Robotics', url: 'https://acme.example.com', tier: 'gold' })
      .expect(201);
    await api().post('/api/ops/sponsors').set(stranger.auth).send({ name: 'Nope' }).expect(403);
    const page = (await api().get(`/api/clubs/${club.user.id}`).expect(200)).body.data;
    assert.deepEqual(
      page.sponsors.map((s: { name: string }) => s.name),
      ['Acme Robotics']
    );
  });
});
