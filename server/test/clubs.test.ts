// Roadmap "Now" #5 (club pages and following) and #7 (onboarding suggestions).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Notification } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('clubs', () => {
  it('shows a club page with upcoming and past events, followers and rating', async () => {
    const club = await createUser({ role: 'organizer', organization: 'Robotics Club', bio: 'We build robots.' });
    const member = await createUser();
    await api()
      .post('/api/events')
      .set(club.auth)
      .send(eventInput({ title: 'Bot Wars' }))
      .expect(201);
    const past = (
      await api()
        .post('/api/events')
        .set(club.auth)
        .send(eventInput({ title: 'Old Meetup' }))
        .expect(201)
    ).body.data;
    await Event.updateOne(
      { _id: past.id },
      { $set: { startsAt: new Date(hoursFromNow(-30)), endsAt: new Date(hoursFromNow(-28)), ratingSum: 9, ratingCount: 2 } }
    );

    const page = (await api().get(`/api/clubs/${club.user.id}`).expect(200)).body.data;
    assert.equal(page.name, 'Robotics Club');
    assert.deepEqual(
      page.upcoming.map((e: { title: string }) => e.title),
      ['Bot Wars']
    );
    assert.deepEqual(
      page.past.map((e: { title: string }) => e.title),
      ['Old Meetup']
    );
    assert.equal(page.averageRating, 4.5);
    assert.equal(page.following, false);

    const followed = (await api().put(`/api/clubs/${club.user.id}/follow`).set(member.auth).expect(200)).body.data;
    await api().put(`/api/clubs/${club.user.id}/follow`).set(member.auth).expect(200);
    assert.deepEqual(followed, { following: true, followers: 1 });
    assert.equal((await api().get(`/api/clubs/${club.user.id}`).set(member.auth)).body.data.following, true);

    await api().get(`/api/clubs/${member.user.id}`).expect(404);
  });

  it('tells followers when the club publishes, including a draft going live', async () => {
    const club = await createUser({ role: 'organizer', organization: 'Robotics Club' });
    const member = await createUser();
    await api().put(`/api/clubs/${club.user.id}/follow`).set(member.auth).expect(200);

    await api()
      .post('/api/events')
      .set(club.auth)
      .send(eventInput({ title: 'Live Now' }))
      .expect(201);
    const draft = (
      await api()
        .post('/api/events')
        .set(club.auth)
        .send(eventInput({ title: 'Later', status: 'draft' }))
        .expect(201)
    ).body.data;
    assert.equal(await Notification.countDocuments({ user: member.user._id, type: 'club_new_event' }), 1);
    await api().patch(`/api/events/${draft.id}`).set(club.auth).send({ status: 'published' }).expect(200);
    const titles = (await Notification.find({ user: member.user._id, type: 'club_new_event' })).map((n) => n.title).sort();
    assert.deepEqual(titles, ['New from Robotics Club: Later', 'New from Robotics Club: Live Now']);
  });

  it('suggests clubs that run events in your interests, skipping ones you follow', async () => {
    const tech = await createUser({ role: 'organizer', organization: 'Coding Club' });
    const sports = await createUser({ role: 'organizer', organization: 'Football Club' });
    const member = await createUser({ interests: ['tech'] });
    await api()
      .post('/api/events')
      .set(tech.auth)
      .send(eventInput({ category: 'tech' }))
      .expect(201);
    await api()
      .post('/api/events')
      .set(sports.auth)
      .send(eventInput({ category: 'sports' }))
      .expect(201);

    let names = (await api().get('/api/clubs/suggestions').set(member.auth).expect(200)).body.data.map(
      (c: { name: string }) => c.name
    );
    assert.deepEqual(names, ['Coding Club']);
    names = (await api().get('/api/clubs/suggestions?interests=sports').set(member.auth).expect(200)).body.data.map(
      (c: { name: string }) => c.name
    );
    assert.deepEqual(names, ['Football Club']);
    await api().put(`/api/clubs/${tech.user.id}/follow`).set(member.auth).expect(200);
    names = (await api().get('/api/clubs/suggestions').set(member.auth).expect(200)).body.data.map(
      (c: { name: string }) => c.name
    );
    assert.deepEqual(names, []);
  });
});
