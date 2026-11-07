// Roadmap "Next" #6 (chat moderation) and #4 (organiser insights).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { AuditLog, Event, Message, Registration } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

async function chatSetup() {
  const owner = await createUser({ role: 'organizer' });
  const [author, bystander] = [await createUser(), await createUser()];
  const event = (await api().post('/api/events').set(owner.auth).send(eventInput()).expect(201)).body.data;
  for (const who of [author, bystander]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
  const message = (await api().post(`/api/events/${event.id}/messages`).set(author.auth).send({ text: 'rude words' }).expect(201))
    .body.data;
  return { owner, author, bystander, event, message };
}

describe('chat moderation', () => {
  it('lets the organiser or the sender remove a message, but not other members', async () => {
    const { owner, bystander, event, message } = await chatSetup();
    await api().delete(`/api/events/${event.id}/messages/${message.id}`).set(bystander.auth).expect(403);
    await api().delete(`/api/events/${event.id}/messages/${message.id}`).set(owner.auth).expect(200);
    const stored = await Message.findById(message.id);
    assert.equal(stored!.text, '');
    assert.ok(stored!.removedAt);
    const thread = (await api().get(`/api/events/${event.id}/messages`).set(bystander.auth).expect(200)).body.data;
    assert.equal(thread[0].text, '');
    assert.ok(thread[0].removedAt);
  });

  it('sends reported messages to the admin queue, where reviewing removes them', async () => {
    const { author, bystander, event, message } = await chatSetup();
    const admin = await createUser({ role: 'admin' });
    await api()
      .post(`/api/events/${event.id}/messages/${message.id}/report`)
      .set(author.auth)
      .send({ reason: 'inappropriate' })
      .expect(400);
    await api()
      .post(`/api/events/${event.id}/messages/${message.id}/report`)
      .set(bystander.auth)
      .send({ reason: 'inappropriate' })
      .expect(201);

    const queue = (await api().get('/api/admin/message-reports?status=open').set(admin.auth).expect(200)).body.data;
    assert.equal(queue.length, 1);
    assert.equal(queue[0].message.text, 'rude words');
    await api().patch(`/api/admin/message-reports/${queue[0].id}`).set(admin.auth).send({ status: 'reviewed' }).expect(200);
    assert.ok((await Message.findById(message.id))!.removedAt);
    assert.ok(await AuditLog.exists({ action: 'message.removed' }));
  });
});

describe('organiser insights', () => {
  it('counts RSVPs per day, statuses, show-ups and ratings', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ capacity: 2 }))
        .expect(201)
    ).body.data;
    for (const who of [a, b, c]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
    await api()
      .put(`/api/events/${event.id}/attendees/${a.user.id}/check-in`)
      .set(owner.auth)
      .send({ checkedIn: true })
      .expect(200);
    await Event.updateOne(
      { _id: event.id },
      { $set: { startsAt: new Date(hoursFromNow(-5)), endsAt: new Date(hoursFromNow(-3)) } }
    );
    await api().put(`/api/events/${event.id}/ratings`).set(a.auth).send({ rating: 4 }).expect(200);

    const data = (await api().get(`/api/organizer/events/${event.id}/insights`).set(owner.auth).expect(200)).body.data;
    assert.equal(data.going, 2);
    assert.equal(data.waitlisted, 1);
    assert.equal(data.checkedIn, 1);
    assert.equal(data.showUpRate, 50);
    assert.equal(data.averageRating, 4);
    assert.equal(
      data.rsvpsByDay.reduce((n: number, d: { count: number }) => n + d.count, 0),
      3
    );
    assert.equal(await Registration.countDocuments(), 3);
    await api().get(`/api/organizer/events/${event.id}/insights`).set(a.auth).expect(403);
  });
});
