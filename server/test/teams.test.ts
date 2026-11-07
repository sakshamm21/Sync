// Roadmap "Next" #2: team registration.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Registration, Team } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('teams', () => {
  it('creates, joins by code, enforces the size, and checks a team in together', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b, c, outsider] = [await createUser(), await createUser(), await createUser(), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ teamSize: { min: 2, max: 2 } }))
        .expect(201)
    ).body.data;
    for (const who of [a, b, c]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
    const base = `/api/events/${event.id}/teams`;

    await api().post(base).set(outsider.auth).send({ name: 'Ghosts' }).expect(400); // not registered
    const team = (await api().post(base).set(a.auth).send({ name: 'Byte Me' }).expect(201)).body.data;
    assert.match(team.code, /^[A-HJ-NP-Z2-9]{6}$/);
    await api().post(base).set(c.auth).send({ name: 'byte me' }).expect(409); // names ignore case

    await api().post(`${base}/join`).set(b.auth).send({ code: team.code.toLowerCase() }).expect(200);
    const full = await api().post(`${base}/join`).set(c.auth).send({ code: team.code }).expect(400);
    assert.equal(full.body.error.code, 'TEAM_FULL');

    const list = (await api().get(base).set(owner.auth).expect(200)).body.data;
    assert.equal(list.teams[0].members.length, 2);
    assert.equal(list.teams[0].complete, true);
    // Other members don't see a team's code.
    assert.equal((await api().get(`${base}/mine`).set(c.auth).expect(200)).body.data, null);

    const checked = (await api().put(`${base}/${team.id}/check-in`).set(owner.auth).expect(200)).body.data;
    assert.equal(checked.checkedIn, 2);
    assert.equal(await Registration.countDocuments({ event: event.id, checkedInAt: { $ne: null } }), 2);
  });

  it('removes people from their team when they leave the event, passing on the captaincy', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b] = [await createUser(), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ teamSize: { min: 1, max: 4 } }))
        .expect(201)
    ).body.data;
    for (const who of [a, b]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
    const team = (await api().post(`/api/events/${event.id}/teams`).set(a.auth).send({ name: 'Solo-ish' }).expect(201)).body.data;
    await api().post(`/api/events/${event.id}/teams/join`).set(b.auth).send({ code: team.code }).expect(200);

    await api().delete(`/api/events/${event.id}/teams/mine`).set(a.auth).expect(200);
    assert.equal(String((await Team.findById(team.id))!.captain), b.user.id);
    await api().delete(`/api/events/${event.id}/registration`).set(b.auth).expect(200);
    assert.equal(await Team.exists({ _id: team.id }), null);
  });

  it('is only for team events', async () => {
    const owner = await createUser({ role: 'organizer' });
    const a = await createUser();
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    await api().post(`/api/events/${event.id}/teams`).set(a.auth).send({ name: 'Nope' }).expect(400);
  });
});
