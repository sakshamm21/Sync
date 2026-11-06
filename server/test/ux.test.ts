// Server pieces of the web app fixes (docs/IMPROVEMENT_PLAN.md, PR 7).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Message } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('B27: chat paging never skips messages', () => {
  it('pages by message id, so messages sharing a timestamp all arrive', async () => {
    const owner = await createUser({ role: 'organizer' });
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    const sameMoment = new Date();
    const docs = await Message.insertMany(
      ['one', 'two', 'three', 'four'].map((text) => ({ event: event.id, sender: owner.user._id, text, createdAt: sameMoment }))
    );

    // Polling after the first message returns the other three, even with equal timestamps.
    const newer = await api().get(`/api/events/${event.id}/messages`).query({ after: String(docs[0]._id) }).set(owner.auth).expect(200);
    assert.deepEqual(newer.body.data.map((m: { text: string }) => m.text), ['two', 'three', 'four']);

    // Scrolling back from the last message, two at a time.
    const older = await api().get(`/api/events/${event.id}/messages`).query({ before: String(docs[3]._id), limit: 2 }).set(owner.auth).expect(200);
    assert.deepEqual(older.body.data.map((m: { text: string }) => m.text), ['two', 'three']);
    assert.equal(older.body.meta.hasMore, true);
  });

  it('still accepts a timestamp cursor from older clients', async () => {
    const owner = await createUser({ role: 'organizer' });
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().get(`/api/events/${event.id}/messages`).query({ after: new Date(0).toISOString() }).set(owner.auth).expect(200);
  });
});

describe('B40: the console is offered to people who run events', () => {
  it('flags members on another event team', async () => {
    const owner = await createUser({ role: 'organizer' });
    const helper = await createUser();
    const bystander = await createUser();
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    await api().post(`/api/event-staff/${event.id}/staff`).set(owner.auth).send({ email: helper.user.email, role: 'checkin' }).expect(201);

    assert.equal((await api().get('/api/me').set(helper.auth).expect(200)).body.data.isEventStaff, true);
    assert.equal((await api().get('/api/me').set(bystander.auth).expect(200)).body.data.isEventStaff, false);
    assert.equal((await api().get('/api/me').set(owner.auth).expect(200)).body.data.isEventStaff, false);
  });
});
