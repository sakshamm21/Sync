// The demo dataset (scripts/demo-data.ts) loads cleanly and sets up every
// scenario TEST_ACCOUNTS.md promises.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api } from './helpers';
import { Notification, OrganizerApplication, User } from '../src/models';
import { seed } from '../scripts/seed';
import * as data from '../scripts/demo-data';

let eventIds: Map<string, string>;
const tokens = new Map<string, string>();

async function signIn(key: string) {
  if (!tokens.has(key)) {
    const { email } = data.users.find((u) => u.key === key)!;
    const res = await api().post('/api/auth/login').send({ email, password: data.DEMO_PASSWORD }).expect(200);
    tokens.set(key, res.body.data.token);
  }
  return { Authorization: `Bearer ${tokens.get(key)}` };
}

const userId = async (key: string) => (await User.findOne({ email: data.users.find((u) => u.key === key)!.email }))!._id;

before(async () => {
  await startDatabase();
  await resetDatabase();
  ({ eventIds } = await seed());
});
after(stopDatabase);

describe('demo data', () => {
  it('creates every account, and all but the suspended one can sign in', async () => {
    assert.equal(await User.countDocuments(), data.users.length);
    for (const u of data.users) {
      const res = await api().post('/api/auth/login').send({ email: u.email, password: data.DEMO_PASSWORD });
      if (u.status === 'suspended') {
        assert.equal(res.status, 403);
        assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
      } else {
        assert.equal(res.status, 200, `${u.email} should sign in`);
        assert.equal(res.body.data.user.role, u.role);
        assert.equal(res.body.data.user.preferences.emailNotifications, false);
      }
    }
  });

  it('lists only published public events, all of them upcoming', async () => {
    const res = await api().get('/api/events?limit=50').expect(200);
    const titles = res.body.data.map((e: { title: string }) => e.title);
    const expected = data.events.filter(
      (e) => (e.visibility ?? 'public') === 'public' && e.status !== 'draft' && !e.cancelledReason && e.ends.day >= 0
    );
    assert.deepEqual([...titles].sort(), expected.map((e) => e.title).sort());
    for (const event of res.body.data) assert.ok(new Date(event.endsAt) > new Date(), `${event.title} is upcoming`);
  });

  it('fills the hackathon: one person left, the waitlist moved up, one is still waiting', async () => {
    const auth = await signIn('tech');
    const res = await api()
      .get(`/api/events/${eventIds.get('hackathon')}/attendees`)
      .set(auth)
      .expect(200);
    const byStatus = (status: string) =>
      res.body.data.items
        .filter((a: { status: string }) => a.status === status)
        .map((a: { user: { name: string } }) => a.user.name)
        .sort();
    assert.deepEqual(byStatus('going'), ['Asha Rao', 'Kabir Singh', 'Priya Sharma']);
    assert.deepEqual(byStatus('waitlisted'), ['Ishaan Gupta']);
    assert.ok(await Notification.exists({ user: await userId('priya'), type: 'waitlist_promoted' }));

    const event = (
      await api()
        .get(`/api/events/${eventIds.get('hackathon')}`)
        .set(await signIn('ishaan'))
        .expect(200)
    ).body.data;
    assert.equal(event.spotsLeft, 0);
    assert.equal(event.viewer.registration, 'waitlisted');
  });

  it('has a nearly full event, a cancelled one and a draft', async () => {
    const devops = (
      await api()
        .get(`/api/events/${eventIds.get('devops')}`)
        .expect(200)
    ).body.data;
    assert.equal(devops.spotsLeft, 3);

    const robotics = (
      await api()
        .get(`/api/events/${eventIds.get('robotics')}`)
        .expect(200)
    ).body.data;
    assert.equal(robotics.status, 'cancelled');
    assert.ok(await Notification.exists({ user: await userId('member'), type: 'event_cancelled' }));

    await api()
      .get(`/api/events/${eventIds.get('pitch')}`)
      .expect(404);
    const draft = await api()
      .get(`/api/events/${eventIds.get('pitch')}`)
      .set(await signIn('tech'))
      .expect(200);
    assert.equal(draft.body.data.status, 'draft');
  });

  it('gives Kabir tickets, private plans, notes, chats and notifications', async () => {
    const auth = await signIn('member');
    const tickets = (await api().get('/api/me/registrations').set(auth).expect(200)).body.data;
    assert.ok(tickets.length >= 5);

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const calendar = (await api().get('/api/me/calendar').query({ from, to }).set(auth).expect(200)).body.data;
    assert.ok(
      calendar.some((e: { title: string; visibility: string }) => e.title === 'Gym session' && e.visibility === 'private')
    );
    // Nobody else can see his private plans.
    await api()
      .get(`/api/events/${eventIds.get('gym')}`)
      .set(await signIn('admin'))
      .expect(404);

    const notes = (await api().get('/api/notes').set(auth).expect(200)).body.data;
    assert.equal(notes.length, data.notes.filter((n) => n.owner === 'member').length);

    const messages = (
      await api()
        .get(`/api/events/${eventIds.get('summit')}/messages`)
        .set(auth)
        .expect(200)
    ).body.data;
    assert.equal(messages.length, 4);

    const notifications = (await api().get('/api/notifications').set(auth).expect(200)).body;
    assert.ok(notifications.meta.unread >= 2);
  });

  it('gives organizers dashboard numbers, including attendance at a past event', async () => {
    const overview = (
      await api()
        .get('/api/organizer/overview')
        .set(await signIn('tech'))
        .expect(200)
    ).body.data;
    assert.equal(overview.stats.drafts, 1);
    assert.equal(overview.stats.attendanceRate, 67);
  });

  it('has one pending and one rejected organizer application', async () => {
    assert.equal((await OrganizerApplication.findOne({ user: await userId('asha') }))!.status, 'pending');
    assert.equal((await OrganizerApplication.findOne({ user: await userId('rahul') }))!.status, 'rejected');
    const pending = (
      await api()
        .get('/api/admin/organizer-applications?status=pending')
        .set(await signIn('admin'))
        .expect(200)
    ).body.data;
    assert.deepEqual(
      pending.map((a: { organization: string }) => a.organization),
      ['Photography Club']
    );
  });

  it('leaves the tester accounts untouched', async () => {
    const auth = await signIn('tester1');
    assert.deepEqual((await api().get('/api/me/registrations').set(auth).expect(200)).body.data, []);
    assert.equal((await api().get('/api/notifications').set(auth).expect(200)).body.meta.unread, 0);
  });
});
