// Roadmap "Next" #6: replies, reactions and unread counts.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Notification } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('chat', () => {
  it('supports replies, toggled reactions and unread counts', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b] = [await createUser({ name: 'Aanya' }), await createUser({ name: 'Kabir' })];
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    for (const who of [a, b]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
    const say = (who: typeof a, body: object) =>
      api().post(`/api/events/${event.id}/messages`).set(who.auth).send(body).expect(201);

    const question = (await say(a, { text: 'Is there parking?' })).body.data;
    const answer = (await say(b, { text: 'Yes, behind LHC', replyTo: question.id })).body.data;
    assert.equal(answer.replyTo.text, 'Is there parking?');
    assert.equal(answer.replyTo.sender.name, 'Aanya');

    const reacted = (
      await api().put(`/api/events/${event.id}/messages/${answer.id}/reactions`).set(a.auth).send({ emoji: '🙏' }).expect(200)
    ).body.data;
    assert.equal(reacted.reactions.length, 1);
    const undone = (
      await api().put(`/api/events/${event.id}/messages/${answer.id}/reactions`).set(a.auth).send({ emoji: '🙏' }).expect(200)
    ).body.data;
    assert.equal(undone.reactions.length, 0);
    await api().put(`/api/events/${event.id}/messages/${answer.id}/reactions`).set(a.auth).send({ emoji: '💩' }).expect(400);

    // Aanya posted before Kabir's answer, so one unread for her; Kabir is up to date (posting marks read).
    let unread = (await api().get(`/api/me/chats/unread?events=${event.id}`).set(a.auth).expect(200)).body.data;
    assert.equal(unread[event.id], 1);
    unread = (await api().get(`/api/me/chats/unread?events=${event.id}`).set(b.auth).expect(200)).body.data;
    assert.equal(unread[event.id], 0);
    await api().post(`/api/events/${event.id}/messages/read`).set(a.auth).expect(200);
    unread = (await api().get(`/api/me/chats/unread?events=${event.id}`).set(a.auth).expect(200)).body.data;
    assert.equal(unread[event.id], 0);
  });
});

describe('mentions and pins', () => {
  it('notifies people @mentioned and lets organisers pin up to three messages', async () => {
    const owner = await createUser({ role: 'organizer', name: 'Olivia Host' });
    const [a, b] = [await createUser({ name: 'Aanya Sharma' }), await createUser({ name: 'Ann Lee' })];
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
    for (const who of [a, b]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);

    const msg = (
      await api()
        .post(`/api/events/${event.id}/messages`)
        .set(b.auth)
        .send({ text: 'Hey @Aanya, can you bring the HDMI cable?' })
        .expect(201)
    ).body.data;
    const mentions = await Notification.find({ type: 'mention' });
    assert.deepEqual(
      mentions.map((n) => String(n.user)),
      [a.user.id],
      '@Aanya is not read as @Ann'
    );

    await api().put(`/api/events/${event.id}/messages/${msg.id}/pin`).set(a.auth).send({ pinned: true }).expect(403);
    await api().put(`/api/events/${event.id}/messages/${msg.id}/pin`).set(owner.auth).send({ pinned: true }).expect(200);
    const pins = (await api().get(`/api/events/${event.id}/messages/pinned`).set(b.auth).expect(200)).body.data;
    assert.deepEqual(
      pins.map((p: { id: string }) => p.id),
      [msg.id]
    );
  });
});
