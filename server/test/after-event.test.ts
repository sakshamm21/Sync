// Roadmap "Next" #5: after the event (feedback, certificates).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('after the event', () => {
  it('gives checked-in attendees a certificate and lets them leave written feedback', async () => {
    const owner = await createUser({ role: 'organizer', organization: 'Robotics Club' });
    const [came, noShow] = [await createUser({ name: 'Aanya Sharma' }), await createUser()];
    const event = (
      await api()
        .post('/api/events')
        .set(owner.auth)
        .send(eventInput({ title: 'Bot Wars' }))
        .expect(201)
    ).body.data;
    for (const who of [came, noShow]) await api().post(`/api/events/${event.id}/registration`).set(who.auth).expect(200);
    await api()
      .put(`/api/events/${event.id}/attendees/${came.user.id}/check-in`)
      .set(owner.auth)
      .send({ checkedIn: true })
      .expect(200);

    // Not before it has finished.
    await api().get(`/api/events/${event.id}/certificate`).set(came.auth).expect(404);
    await Event.updateOne(
      { _id: event.id },
      { $set: { startsAt: new Date(hoursFromNow(-5)), endsAt: new Date(hoursFromNow(-3)) } }
    );

    const cert = (await api().get(`/api/events/${event.id}/certificate`).set(came.auth).expect(200)).body.data;
    assert.equal(cert.name, 'Aanya Sharma');
    assert.equal(cert.host, 'Robotics Club');
    assert.match(cert.reference, /^SYNC-[0-9A-F]{8}$/);
    await api().get(`/api/events/${event.id}/certificate`).set(noShow.auth).expect(404);

    const rated = (
      await api()
        .put(`/api/events/${event.id}/ratings`)
        .set(came.auth)
        .send({ rating: 5, comment: 'Loved the finals' })
        .expect(200)
    ).body.data;
    assert.equal(rated.myComment, 'Loved the finals');
    const feedback = (await api().get(`/api/events/${event.id}/feedback`).set(owner.auth).expect(200)).body.data;
    assert.deepEqual(
      feedback.map((f: { comment: string }) => f.comment),
      ['Loved the finals']
    );
    await api().get(`/api/events/${event.id}/feedback`).set(came.auth).expect(403);

    const past = (await api().get('/api/me/registrations?upcoming=false').set(came.auth).expect(200)).body.data;
    assert.equal(past[0].viewer.checkedIn, true);
  });
});
