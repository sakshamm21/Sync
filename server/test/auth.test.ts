import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser } from './helpers';
import { User } from '../src/models';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

async function registerAndVerify(overrides = {}) {
  const body = { name: 'Asha Rao', email: 'asha@example.com', password: 'correct-horse', ...overrides };
  const registered = await api().post('/api/auth/register').send(body).expect(201);
  const verified = await api()
    .post('/api/auth/verify-email')
    .send({ email: body.email, code: registered.body.data.devCode })
    .expect(200);
  return { body, session: verified.body.data };
}

describe('registration and email verification', () => {
  it('registers a member and returns a dev code when email is not configured', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Asha Rao', email: 'Asha@Example.com ', password: 'correct-horse' })
      .expect(201);

    assert.equal(res.body.data.email, 'asha@example.com');
    assert.equal(res.body.data.emailDelivered, false);
    assert.match(res.body.data.devCode, /^\d{6}$/);

    const user = await User.findOne({ email: 'asha@example.com' });
    assert.equal(user!.role, 'member');
    assert.equal(user!.emailVerified, false);
  });

  it('ignores any attempt to self-assign a privileged role', async () => {
    await api()
      .post('/api/auth/register')
      .send({ name: 'Mallory', email: 'm@example.com', password: 'correct-horse', role: 'admin' })
      .expect(201);
    assert.equal((await User.findOne({ email: 'm@example.com' }))!.role, 'member');
  });

  it('verifies the email with the code and signs the user in', async () => {
    const { session } = await registerAndVerify();
    assert.ok(session.token);
    assert.equal(session.user.email, 'asha@example.com');
    assert.equal(session.user.emailVerified, true);
    assert.equal(session.user.passwordHash, undefined);

    const me = await api().get('/api/me').set('Authorization', `Bearer ${session.token}`).expect(200);
    assert.equal(me.body.data.name, 'Asha Rao');
  });

  it('rejects wrong codes and locks out after too many attempts', async () => {
    const registered = await api()
      .post('/api/auth/register')
      .send({ name: 'Asha', email: 'a@example.com', password: 'correct-horse' });
    const { devCode } = registered.body.data;
    const wrongCode = devCode === '000000' ? '111111' : '000000';

    const wrong = await api().post('/api/auth/verify-email').send({ email: 'a@example.com', code: wrongCode }).expect(400);
    assert.equal(wrong.body.error.code, 'INVALID_CODE');
    assert.match(wrong.body.error.message, /4 attempts left/);

    for (let i = 0; i < 4; i += 1) {
      await api().post('/api/auth/verify-email').send({ email: 'a@example.com', code: wrongCode });
    }
    // Even the right code is refused once the attempts are used up.
    const locked = await api().post('/api/auth/verify-email').send({ email: 'a@example.com', code: devCode }).expect(429);
    assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
  });

  it('rejects registering an email that is already verified', async () => {
    await registerAndVerify();
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Other', email: 'asha@example.com', password: 'another-pass' })
      .expect(409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  it('enforces a cooldown between verification emails', async () => {
    await api().post('/api/auth/register').send({ name: 'Asha', email: 'a@example.com', password: 'correct-horse' });
    const res = await api().post('/api/auth/resend-verification').send({ email: 'a@example.com' }).expect(429);
    assert.equal(res.body.error.code, 'RESEND_COOLDOWN');
  });

  it('does not reveal whether an email is registered when resending', async () => {
    const res = await api().post('/api/auth/resend-verification').send({ email: 'ghost@example.com' }).expect(200);
    assert.deepEqual(res.body.data, { email: 'ghost@example.com' });
  });

  it('returns field-level validation errors', async () => {
    const res = await api().post('/api/auth/register').send({ email: 'not-an-email', password: 'short' }).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ['body.email', 'body.name', 'body.password']);
    assert.equal(res.body.error.details.find((d) => d.field === 'body.name').message, 'Name is required');
  });
});

describe('login', () => {
  it('signs in with the right credentials', async () => {
    await registerAndVerify();
    const res = await api().post('/api/auth/login').send({ email: 'ASHA@example.com', password: 'correct-horse' }).expect(200);
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.user.role, 'member');
  });

  it('uses one generic error for unknown emails and wrong passwords', async () => {
    await registerAndVerify();
    const wrongPassword = await api().post('/api/auth/login').send({ email: 'asha@example.com', password: 'nope-nope' });
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrongPassword.body.error.message, unknown.body.error.message);
  });

  it('asks unverified users to verify first', async () => {
    await api().post('/api/auth/register').send({ name: 'Asha', email: 'a@example.com', password: 'correct-horse' });
    const res = await api().post('/api/auth/login').send({ email: 'a@example.com', password: 'correct-horse' }).expect(403);
    assert.equal(res.body.error.code, 'EMAIL_NOT_VERIFIED');
  });

  it('blocks suspended accounts, including existing sessions', async () => {
    const { user, auth } = await createUser({ email: 's@example.com' });
    await User.updateOne({ _id: user._id }, { status: 'suspended' });

    const login = await api().post('/api/auth/login').send({ email: 's@example.com', password: 'password123' }).expect(403);
    assert.equal(login.body.error.code, 'ACCOUNT_SUSPENDED');
    await api().get('/api/me').set(auth).expect(403);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    await api().get('/api/me').expect(401);
    await api().get('/api/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const { token } = await createUser();
    await api()
      .get('/api/me')
      .set('Authorization', `Bearer ${token.slice(0, -2)}xx`)
      .expect(401);
  });
});

describe('password reset and change', () => {
  it('resets the password via the emailed link and invalidates old sessions', async () => {
    const { user, token: oldToken } = await createUser({ email: 'r@example.com' });

    // JWT `iat` has one-second resolution; make sure the old token is strictly older.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const forgot = await api().post('/api/auth/forgot-password').send({ email: 'r@example.com' }).expect(200);
    const token = new URL(forgot.body.data.devResetUrl).searchParams.get('token');

    const reset = await api().post('/api/auth/reset-password').send({ token, password: 'brand-new-pass' }).expect(200);
    assert.equal(reset.body.data.user.id, user.id);

    await api().get('/api/me').set('Authorization', `Bearer ${oldToken}`).expect(401);
    await api().get('/api/me').set('Authorization', `Bearer ${reset.body.data.token}`).expect(200);
    await api().post('/api/auth/login').send({ email: 'r@example.com', password: 'brand-new-pass' }).expect(200);

    // The link is single-use.
    await api().post('/api/auth/reset-password').send({ token, password: 'another-pass' }).expect(400);
  });

  it('responds the same way for unknown emails', async () => {
    const res = await api().post('/api/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200);
    assert.deepEqual(res.body.data, {});
  });

  it('changes the password when the current one is correct', async () => {
    const { auth } = await createUser({ email: 'c@example.com' });
    await api()
      .post('/api/me/password')
      .set(auth)
      .send({ currentPassword: 'wrong-one', newPassword: 'new-password' })
      .expect(400);
    const res = await api()
      .post('/api/me/password')
      .set(auth)
      .send({ currentPassword: 'password123', newPassword: 'new-password' })
      .expect(200);
    assert.ok(res.body.data.token);
    await api().post('/api/auth/login').send({ email: 'c@example.com', password: 'new-password' }).expect(200);
  });
});

describe('profile', () => {
  it('updates profile fields, interests and preferences', async () => {
    const { auth } = await createUser();
    const res = await api()
      .patch('/api/me')
      .set(auth)
      .send({ bio: 'Loves hackathons', interests: ['tech', 'workshop'], preferences: { emailNotifications: false } })
      .expect(200);
    assert.equal(res.body.data.bio, 'Loves hackathons');
    assert.deepEqual(res.body.data.interests, ['tech', 'workshop']);
    assert.equal(res.body.data.preferences.emailNotifications, false);
  });

  it('does not let users change their own role through the profile', async () => {
    const { auth } = await createUser();
    const res = await api().patch('/api/me').set(auth).send({ name: 'New Name', role: 'admin' }).expect(200);
    assert.equal(res.body.data.role, 'member');
  });
});
