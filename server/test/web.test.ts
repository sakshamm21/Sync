import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startDatabase, stopDatabase, api, createUser, databaseUri } from './helpers';
import { connectDatabase } from '../src/config/db';

before(startDatabase);
after(stopDatabase);

describe('HTTP basics', () => {
  it('reports health including the database connection', async () => {
    const res = await api().get('/api/health').expect(200);
    assert.equal(res.body.data.status, 'ok');
    assert.equal(res.body.data.database, 'up');
  });

  it('returns JSON 404s for unknown routes', async () => {
    const res = await api().get('/api/does-not-exist').expect(404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });

  it('returns a clear error for malformed JSON bodies', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });

  it('sets security headers and allows the configured client origin', async () => {
    const res = await api().get('/api/meta').set('Origin', 'http://localhost:3000').expect(200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:3000');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('does not allow other origins', async () => {
    const res = await api().get('/api/meta').set('Origin', 'https://evil.example').expect(200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});

describe('database connection', () => {
  it('reconnects after the connection was closed elsewhere', async () => {
    await mongoose.disconnect();
    await connectDatabase(databaseUri());
    assert.equal(mongoose.connection.readyState, 1);
    await api().get('/api/health').expect(200);
  });
});

describe('AI assistant without a key', () => {
  it('reports itself as off and refuses politely', async () => {
    const meta = await api().get('/api/meta').expect(200);
    assert.equal(meta.body.data.assistant, false);

    const { auth } = await createUser();
    const res = await api()
      .post('/api/assistant/chat')
      .set(auth)
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(503);
    assert.equal(res.body.error.code, 'ASSISTANT_DISABLED');
  });
});
