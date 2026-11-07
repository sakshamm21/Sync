// Roadmap "Next" #1: registration questions and organiser approval.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { Event, Notification, Registration } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

const questions = [
  { label: 'Roll number', kind: 'text', required: true },
  { label: 'T-shirt size', kind: 'choice', options: ['S', 'M', 'L'], required: false },
];

describe('registration questions', () => {
  it('requires required answers, checks choices, and shows answers to the organiser', async () => {
    const owner = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (await api().post('/api/events').set(owner.auth).send(eventInput({ questions })).expect(201)).body.data;
    const [roll, size] = event.questions.map((q: { id: string }) => q.id);

    const missing = await api().post(`/api/events/${event.id}/registration`).set(member.auth).send({}).expect(400);
    assert.equal(missing.body.error.code, 'ANSWER_REQUIRED');
    const bad = await api()
      .post(`/api/events/${event.id}/registration`)
      .set(member.auth)
      .send({
        answers: [
          { question: roll, answer: '21CS042' },
          { question: size, answer: 'XXL' },
        ],
      })
      .expect(400);
    assert.equal(bad.body.error.code, 'BAD_ANSWER');

    await api()
      .post(`/api/events/${event.id}/registration`)
      .set(member.auth)
      .send({
        answers: [
          { question: roll, answer: '21CS042' },
          { question: size, answer: 'M' },
        ],
      })
      .expect(200);
    const list = (await api().get(`/api/events/${event.id}/attendees`).set(owner.auth).expect(200)).body.data;
    assert.deepEqual(list.items[0].answers, [
      { question: 'Roll number', answer: '21CS042' },
      { question: 'T-shirt size', answer: 'M' },
    ]);
  });

  it('rejects a choice question with fewer than two options', async () => {
    const owner = await createUser({ role: 'organizer' });
    await api()
      .post('/api/events')
      .set(owner.auth)
      .send(eventInput({ questions: [{ label: 'Pick', kind: 'choice', options: ['Only'] }] }))
      .expect(400);
  });
});

describe('approval', () => {
  it('holds requests without a seat until the organiser decides', async () => {
    const owner = await createUser({ role: 'organizer' });
    const [yes, no] = [await createUser(), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ capacity: 5, requiresApproval: true }))
        .expect(201)
    ).body.data;

    const asked = (await api().post(`/api/events/${event.id}/registration`).set(yes.auth).send({}).expect(200)).body.data;
    await api().post(`/api/events/${event.id}/registration`).set(no.auth).send({}).expect(200);
    assert.equal(asked.viewer.registration, 'pending');
    assert.equal((await Event.findById(event.id))!.attendeeCount, 0);
    assert.ok(await Notification.exists({ user: owner.user._id, title: /^New request/ }));
    // A pending request has no ticket.
    assert.equal((await api().get(`/api/events/${event.id}/ticket`).set(yes.auth).expect(200)).body.data, null);

    const after = (
      await api()
        .put(`/api/events/${event.id}/attendees/${yes.user.id}/approval`)
        .set(owner.auth)
        .send({ approve: true })
        .expect(200)
    ).body.data;
    assert.equal(after.counts.pending, 1);
    assert.equal((await Registration.findOne({ user: yes.user._id }))!.status, 'going');
    assert.equal((await Event.findById(event.id))!.attendeeCount, 1);

    await api()
      .put(`/api/events/${event.id}/attendees/${no.user.id}/approval`)
      .set(owner.auth)
      .send({ approve: false })
      .expect(200);
    assert.equal(await Registration.exists({ user: no.user._id }), null);
    assert.ok(await Notification.exists({ user: no.user._id, title: /^Not this time/ }));

    // Only managers decide.
    await api()
      .put(`/api/events/${event.id}/attendees/${yes.user.id}/approval`)
      .set(yes.auth)
      .send({ approve: true })
      .expect(403);
  });
});
