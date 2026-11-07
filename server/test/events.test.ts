import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';
import { Event, Registration, Notification, Message, Note } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

async function publishEvent(organizer, overrides = {}) {
  const res = await api().post('/api/events').set(organizer.auth).send(eventInput(overrides)).expect(201);
  return res.body.data;
}

describe('creating events', () => {
  it('lets organisers publish public events', async () => {
    const organizer = await createUser({ role: 'organizer', organization: 'Tech Society' });
    const event = await publishEvent(organizer, { capacity: 50 });

    assert.equal(event.visibility, 'public');
    assert.equal(event.status, 'published');
    assert.equal(event.capacity, 50);
    assert.equal(event.spotsLeft, 50);
    assert.equal(event.owner.organization, 'Tech Society');
    assert.equal(event.viewer.isOwner, true);
    assert.equal(event.viewer.isOrganizer, true);
    assert.equal(event.viewer.canManage, true);
    assert.equal(event.viewer.canChat, true);
    assert.equal(event.viewer.staffRole, 'owner');
    assert.equal(event.viewer.registration, null);
  });

  it('makes member events private personal entries', async () => {
    const member = await createUser();
    const res = await api()
      .post('/api/events')
      .set(member.auth)
      .send(eventInput({ capacity: 10 }))
      .expect(201);
    assert.equal(res.body.data.visibility, 'private');
    assert.equal(res.body.data.capacity, null);
  });

  it('tells members how to publish public events', async () => {
    const member = await createUser();
    const res = await api()
      .post('/api/events')
      .set(member.auth)
      .send(eventInput({ visibility: 'public' }))
      .expect(403);
    assert.equal(res.body.error.code, 'ORGANIZER_ONLY');
  });

  it('validates that events end after they start', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const res = await api()
      .post('/api/events')
      .set(organizer.auth)
      .send(eventInput({ startsAt: hoursFromNow(5), endsAt: hoursFromNow(4) }))
      .expect(400);
    assert.equal(res.body.error.details[0].field, 'body.endsAt');
  });
});

describe('discovering events', () => {
  it('lists only upcoming published public events, with filters and search', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    await publishEvent(organizer, { title: 'AI Hackathon', category: 'tech' });
    await publishEvent(organizer, { title: 'Dance Night', category: 'cultural' });
    await publishEvent(organizer, { title: 'Secret Draft', status: 'draft' });
    await publishEvent(organizer, { title: 'Old Meetup', startsAt: hoursFromNow(-5), endsAt: hoursFromNow(-4) });
    await api()
      .post('/api/events')
      .set(member.auth)
      .send(eventInput({ title: 'My dentist' }));

    const all = await api().get('/api/events').expect(200);
    assert.deepEqual(all.body.data.map((e) => e.title).sort(), ['AI Hackathon', 'Dance Night']);
    assert.equal(all.body.meta.total, 2);

    const tech = await api().get('/api/events?category=tech').expect(200);
    assert.deepEqual(
      tech.body.data.map((e) => e.title),
      ['AI Hackathon']
    );

    const search = await api().get('/api/events?q=hack').expect(200);
    assert.deepEqual(
      search.body.data.map((e) => e.title),
      ['AI Hackathon']
    );

    const withPast = await api().get('/api/events?includePast=true').expect(200);
    assert.equal(withPast.body.meta.total, 3);
  });

  it('treats regex characters in search as plain text', async () => {
    await api().get('/api/events?q=(((').expect(200);
  });

  it('hides private and draft events from everyone but their owner', async () => {
    const member = await createUser();
    const stranger = await createUser();
    const organizer = await createUser({ role: 'organizer' });
    const admin = await createUser({ role: 'admin' });

    const personal = (await api().post('/api/events').set(member.auth).send(eventInput())).body.data;
    const draft = await publishEvent(organizer, { status: 'draft' });

    await api().get(`/api/events/${personal.id}`).set(member.auth).expect(200);
    await api().get(`/api/events/${personal.id}`).set(stranger.auth).expect(404);
    await api().get(`/api/events/${personal.id}`).set(admin.auth).expect(404);
    await api().get(`/api/events/${personal.id}`).expect(404);

    await api().get(`/api/events/${draft.id}`).set(stranger.auth).expect(404);
    await api().get(`/api/events/${draft.id}`).set(admin.auth).expect(200);
  });

  it('returns 400 for malformed ids and 404 for unknown ones', async () => {
    await api().get('/api/events/not-an-id').expect(400);
    await api().get('/api/events/64b000000000000000000000').expect(404);
  });

  it('recommends events matching interests that the user has not joined', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser({ interests: ['sports'] });
    const football = await publishEvent(organizer, { title: 'Football', category: 'sports' });
    const joined = await publishEvent(organizer, { title: 'Cricket', category: 'sports' });
    await publishEvent(organizer, { title: 'Coding', category: 'tech' });
    await api().post(`/api/events/${joined.id}/registration`).set(member.auth).expect(200);

    const res = await api().get('/api/events/recommended').set(member.auth).expect(200);
    const titles = res.body.data.map((e) => e.title);
    assert.equal(titles[0], football.title);
    assert.ok(!titles.includes('Cricket'));
    assert.ok(titles.includes('Coding'), 'tops up with other events');
  });
});

describe('registration and waitlist', () => {
  it('registers attendees and waitlists them once the event is full', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const [a, b] = [await createUser(), await createUser()];
    const event = await publishEvent(organizer, { capacity: 1 });

    const first = await api().post(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    assert.equal(first.body.data.viewer.registration, 'going');
    assert.equal(first.body.data.spotsLeft, 0);

    const second = await api().post(`/api/events/${event.id}/registration`).set(b.auth).expect(200);
    assert.equal(second.body.data.viewer.registration, 'waitlisted');

    // Registering again is idempotent.
    await api().post(`/api/events/${event.id}/registration`).set(a.auth).expect(200);
    assert.equal((await Event.findById(event.id))!.attendeeCount, 1);
  });

  it('never oversells seats under concurrent registrations', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const event = await publishEvent(organizer, { capacity: 3 });
    const people = await Promise.all(Array.from({ length: 10 }, () => createUser()));

    await Promise.all(people.map((p) => api().post(`/api/events/${event.id}/registration`).set(p.auth).expect(200)));

    assert.equal((await Event.findById(event.id))!.attendeeCount, 3);
    assert.equal(await Registration.countDocuments({ event: event.id, status: 'going' }), 3);
    assert.equal(await Registration.countDocuments({ event: event.id, status: 'waitlisted' }), 7);
  });

  it('promotes the first waitlisted person when someone leaves, and notifies them', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const event = await publishEvent(organizer, { capacity: 1 });

    await api().post(`/api/events/${event.id}/registration`).set(a.auth);
    await api().post(`/api/events/${event.id}/registration`).set(b.auth);
    await api().post(`/api/events/${event.id}/registration`).set(c.auth);

    await api().delete(`/api/events/${event.id}/registration`).set(a.auth).expect(200);

    const bView = await api().get(`/api/events/${event.id}`).set(b.auth);
    const cView = await api().get(`/api/events/${event.id}`).set(c.auth);
    assert.equal(bView.body.data.viewer.registration, 'going');
    assert.equal(cView.body.data.viewer.registration, 'waitlisted');
    assert.equal((await Event.findById(event.id))!.attendeeCount, 1);

    const notes = await api().get('/api/notifications').set(b.auth).expect(200);
    assert.equal(notes.body.data[0].type, 'waitlist_promoted');
    assert.equal(notes.body.meta.unread, 1);
  });

  it('promotes waitlisted people when the organiser adds capacity', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const [a, b] = [await createUser(), await createUser()];
    const event = await publishEvent(organizer, { capacity: 1 });
    await api().post(`/api/events/${event.id}/registration`).set(a.auth);
    await api().post(`/api/events/${event.id}/registration`).set(b.auth);

    const updated = await api().patch(`/api/events/${event.id}`).set(organizer.auth).send({ capacity: 5 }).expect(200);
    assert.equal(updated.body.data.attendeeCount, 2);
    assert.equal((await Registration.findOne({ user: b.user._id }))!.status, 'going');
  });

  it('closes registration for cancelled, past and personal events, and for the organiser', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const past = await publishEvent(organizer, { startsAt: hoursFromNow(-3), endsAt: hoursFromNow(-2) });
    const cancelled = await publishEvent(organizer);
    await api().post(`/api/events/${cancelled.id}/cancel`).set(organizer.auth).send({}).expect(200);
    const personal = (await api().post('/api/events').set(member.auth).send(eventInput())).body.data;
    const open = await publishEvent(organizer);

    for (const id of [past.id, cancelled.id, personal.id]) {
      const res = await api().post(`/api/events/${id}/registration`).set(member.auth).expect(400);
      assert.equal(res.body.error.code, 'REGISTRATION_CLOSED');
    }
    const own = await api().post(`/api/events/${open.id}/registration`).set(organizer.auth).expect(400);
    assert.equal(own.body.error.code, 'OWN_EVENT');
  });

  it("lists the user's upcoming registrations", async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const later = await publishEvent(organizer, { title: 'Later', startsAt: hoursFromNow(100), endsAt: hoursFromNow(101) });
    const sooner = await publishEvent(organizer, { title: 'Sooner', startsAt: hoursFromNow(10), endsAt: hoursFromNow(11) });
    await api().post(`/api/events/${later.id}/registration`).set(member.auth);
    await api().post(`/api/events/${sooner.id}/registration`).set(member.auth);

    const res = await api().get('/api/me/registrations').set(member.auth).expect(200);
    assert.deepEqual(
      res.body.data.map((e) => e.title),
      ['Sooner', 'Later']
    );
  });
});

describe('managing events', () => {
  it('only lets the owner or an admin edit a public event', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const otherOrganizer = await createUser({ role: 'organizer' });
    const admin = await createUser({ role: 'admin' });
    const event = await publishEvent(organizer);

    await api().patch(`/api/events/${event.id}`).set(otherOrganizer.auth).send({ title: 'Hijacked' }).expect(403);
    await api().patch(`/api/events/${event.id}`).set(admin.auth).send({ title: 'Moderated title' }).expect(200);
  });

  it('notifies attendees when the time or venue changes, but not for cosmetic edits', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publishEvent(organizer);
    await api().post(`/api/events/${event.id}/registration`).set(member.auth);

    await api().patch(`/api/events/${event.id}`).set(organizer.auth).send({ description: 'Now with pizza' }).expect(200);
    assert.equal(await Notification.countDocuments({ user: member.user._id }), 0);

    await api()
      .patch(`/api/events/${event.id}`)
      .set(organizer.auth)
      .send({ venue: { name: 'Main Auditorium' } })
      .expect(200);
    const notification = await Notification.findOne({ user: member.user._id });
    assert.equal(notification!.type, 'event_updated');
  });

  it('rejects an edit that would make the event end before it starts', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const event = await publishEvent(organizer);
    await api()
      .patch(`/api/events/${event.id}`)
      .set(organizer.auth)
      .send({ endsAt: hoursFromNow(1) })
      .expect(400);
  });

  it('cancels an event and tells everyone registered', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publishEvent(organizer);
    await api().post(`/api/events/${event.id}/registration`).set(member.auth);

    const res = await api()
      .post(`/api/events/${event.id}/cancel`)
      .set(organizer.auth)
      .send({ reason: 'Venue flooded' })
      .expect(200);
    assert.equal(res.body.data.status, 'cancelled');

    const notification = await Notification.findOne({ user: member.user._id });
    assert.equal(notification!.type, 'event_cancelled');
    assert.equal(notification!.body, 'Venue flooded');
    await api().patch(`/api/events/${event.id}`).set(organizer.auth).send({ title: 'Back on' }).expect(400);
  });

  it('deletes an event with its registrations and messages, and unlinks notes', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = await publishEvent(organizer);
    await api().post(`/api/events/${event.id}/registration`).set(member.auth);
    await api().post(`/api/events/${event.id}/messages`).set(member.auth).send({ text: 'Hi!' }).expect(201);
    await api().post('/api/notes').set(member.auth).send({ title: 'Bring laptop', event: event.id }).expect(201);

    await api().delete(`/api/events/${event.id}`).set(organizer.auth).expect(204);

    assert.equal(await Event.countDocuments(), 0);
    assert.equal(await Registration.countDocuments(), 0);
    assert.equal(await Message.countDocuments(), 0);
    assert.equal((await Note.findOne())!.event, null);
    assert.equal((await Notification.findOne({ user: member.user._id }))!.type, 'event_cancelled');
  });

  it('shows the organiser the attendee list and supports check-in', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const [a, b] = [await createUser({ name: 'Ada' }), await createUser({ name: 'Bo' })];
    const event = await publishEvent(organizer, { capacity: 1 });
    await api().post(`/api/events/${event.id}/registration`).set(a.auth);
    await api().post(`/api/events/${event.id}/registration`).set(b.auth);

    await api().get(`/api/events/${event.id}/attendees`).set(a.auth).expect(403);

    const list = await api().get(`/api/events/${event.id}/attendees`).set(organizer.auth).expect(200);
    assert.deepEqual(list.body.data.counts, { going: 1, waitlisted: 1, checkedIn: 0 });
    assert.equal(list.body.data.items[0].user.name, 'Ada');
    assert.ok(list.body.data.items[0].user.email);

    const checkIn = await api()
      .put(`/api/events/${event.id}/attendees/${a.user.id}/check-in`)
      .set(organizer.auth)
      .send({ checkedIn: true })
      .expect(200);
    assert.ok(checkIn.body.data.checkedInAt);

    await api().put(`/api/events/${event.id}/attendees/${b.user.id}/check-in`).set(organizer.auth).send({}).expect(400);

    const overview = await api().get('/api/organizer/overview').set(organizer.auth).expect(200);
    assert.equal(overview.body.data.stats.totalRegistrations, 1);
    assert.equal(overview.body.data.stats.waitlisted, 1);
    assert.deepEqual(overview.body.data.events[0].stats, { going: 1, waitlisted: 1, checkedIn: 1 });
  });
});

describe('calendar', () => {
  it("combines the user's personal and registered events in a date range", async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const joined = await publishEvent(organizer, { title: 'Joined' });
    await publishEvent(organizer, { title: 'Not joined' });
    await api().post(`/api/events/${joined.id}/registration`).set(member.auth);
    await api()
      .post('/api/events')
      .set(member.auth)
      .send(eventInput({ title: 'Study group' }));
    await api()
      .post('/api/events')
      .set(member.auth)
      .send(eventInput({ title: 'Next year', startsAt: hoursFromNow(24 * 300), endsAt: hoursFromNow(24 * 300 + 1) }));

    const res = await api()
      .get('/api/me/calendar')
      .query({ from: new Date().toISOString(), to: hoursFromNow(24 * 30) })
      .set(member.auth)
      .expect(200);
    assert.deepEqual(res.body.data.map((e) => e.title).sort(), ['Joined', 'Study group']);
  });

  it('requires a valid range', async () => {
    const member = await createUser();
    await api().get('/api/me/calendar').set(member.auth).expect(400);
    await api()
      .get('/api/me/calendar')
      .query({ from: hoursFromNow(5), to: hoursFromNow(1) })
      .set(member.auth)
      .expect(400);
  });

  it('exports an event as an iCalendar file', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const event = await publishEvent(organizer, { title: 'Demo Day, 2026; Finals' });

    const res = await api().get(`/api/events/${event.id}/calendar.ics`).expect(200);
    assert.match(res.headers['content-type'], /text\/calendar/);
    assert.match(res.headers['content-disposition'], /demo-day-2026-finals\.ics/);
    assert.match(res.text, /BEGIN:VEVENT/);
    assert.match(res.text, /SUMMARY:Demo Day\\, 2026\\; Finals/);
  });
});
