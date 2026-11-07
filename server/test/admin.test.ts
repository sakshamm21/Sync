import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput } from './helpers';
import { User, Notification } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('becoming an organiser', () => {
  it('runs the full application → approval flow', async () => {
    const member = await createUser();
    const admin = await createUser({ role: 'admin' });

    const applied = await api()
      .post('/api/organizer/applications')
      .set(member.auth)
      .send({ organization: 'Robotics Club', reason: 'We run weekly build nights' })
      .expect(201);
    assert.equal(applied.body.data.status, 'pending');

    const duplicate = await api()
      .post('/api/organizer/applications')
      .set(member.auth)
      .send({ organization: 'Again' })
      .expect(409);
    assert.equal(duplicate.body.error.code, 'APPLICATION_PENDING');

    const pending = await api().get('/api/admin/organizer-applications?status=pending').set(admin.auth).expect(200);
    assert.equal(pending.body.data[0].user.email, member.user.email);

    const approved = await api()
      .post(`/api/admin/organizer-applications/${applied.body.data.id}/approve`)
      .set(admin.auth)
      .send({})
      .expect(200);
    assert.equal(approved.body.data.status, 'approved');
    assert.equal(approved.body.data.reviewedBy.name, admin.user.name);

    const upgraded = await User.findById(member.user._id);
    assert.equal(upgraded!.role, 'organizer');
    assert.equal(upgraded!.organization, 'Robotics Club');
    assert.equal((await Notification.findOne({ user: member.user._id }))!.type, 'organizer_approved');

    // The existing token keeps working and now carries organiser permissions.
    await api()
      .post('/api/events')
      .set(member.auth)
      .send(eventInput({ visibility: 'public' }))
      .expect(201);

    await api().post(`/api/admin/organizer-applications/${applied.body.data.id}/reject`).set(admin.auth).send({}).expect(409);
  });

  it('records rejections with a note and lets the member see the outcome', async () => {
    const member = await createUser();
    const admin = await createUser({ role: 'admin' });
    const { body } = await api().post('/api/organizer/applications').set(member.auth).send({ organization: 'Club' });

    await api()
      .post(`/api/admin/organizer-applications/${body.data.id}/reject`)
      .set(admin.auth)
      .send({ note: 'Please apply with your club email' })
      .expect(200);

    const latest = await api().get('/api/organizer/applications/latest').set(member.auth).expect(200);
    assert.equal(latest.body.data.status, 'rejected');
    assert.equal(latest.body.data.reviewNote, 'Please apply with your club email');
    assert.equal((await User.findById(member.user._id))!.role, 'member');
  });

  it('does not accept applications from existing organisers', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const res = await api().post('/api/organizer/applications').set(organizer.auth).send({ organization: 'X Club' }).expect(400);
    assert.equal(res.body.error.code, 'ALREADY_ORGANIZER');
  });

  it('keeps the organiser dashboard for organisers', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const overview = await api().get('/api/organizer/overview').set(organizer.auth).expect(200);
    assert.ok(overview.body.data);
    assert.deepEqual(overview.body.data.events, []);
  });

  it('shows a member an empty console rather than hiding the page', async () => {
    // A member who has been invited to help run one event still needs to
    // reach the console, so the endpoint is open; the service returns only
    // what that person is allowed to see.
    const member = await createUser();
    const overview = await api().get('/api/organizer/overview').set(member.auth).expect(200);
    assert.deepEqual(overview.body.data.events, []);
  });
});

describe('platform administration', () => {
  it('is restricted to admins', async () => {
    const organizer = await createUser({ role: 'organizer' });
    await api().get('/api/admin/stats').set(organizer.auth).expect(403);
    await api().get('/api/admin/users').expect(401);
  });

  it('reports platform stats', async () => {
    const admin = await createUser({ role: 'admin' });
    const organizer = await createUser({ role: 'organizer' });
    await createUser();
    await api().post('/api/events').set(organizer.auth).send(eventInput());

    const res = await api().get('/api/admin/stats').set(admin.auth).expect(200);
    assert.deepEqual(res.body.data.users.byRole, { member: 1, organizer: 1, admin: 1 });
    assert.equal(res.body.data.events.upcoming, 1);
  });

  it('searches and filters users', async () => {
    const admin = await createUser({ role: 'admin' });
    await createUser({ name: 'Priya Sharma', role: 'organizer' });
    await createUser({ name: 'Rahul Verma' });

    const search = await api().get('/api/admin/users?q=priya').set(admin.auth).expect(200);
    assert.deepEqual(
      search.body.data.map((u) => u.name),
      ['Priya Sharma']
    );
    assert.equal(search.body.data[0].passwordHash, undefined);

    const organizers = await api().get('/api/admin/users?role=organizer').set(admin.auth).expect(200);
    assert.equal(organizers.body.meta.total, 1);
  });

  it('suspends and reinstates users, but not themselves', async () => {
    const admin = await createUser({ role: 'admin' });
    const target = await createUser();

    await api().patch(`/api/admin/users/${target.user.id}`).set(admin.auth).send({ status: 'suspended' }).expect(200);
    await api().get('/api/me').set(target.auth).expect(403);

    await api().patch(`/api/admin/users/${target.user.id}`).set(admin.auth).send({ status: 'active' }).expect(200);
    await api().get('/api/me').set(target.auth).expect(200);

    await api().patch(`/api/admin/users/${admin.user.id}`).set(admin.auth).send({ role: 'member' }).expect(400);
  });
});
