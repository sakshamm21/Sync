import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

describe('venue directory', () => {
  it('groups upcoming public events by venue, skipping events without coordinates', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const publish = (overrides) => api().post('/api/events').set(organizer.auth).send(eventInput(overrides)).expect(201);
    const lab = { name: 'Innovation Lab', latitude: 26.51, longitude: 80.23 };

    await publish({ title: 'Hack night', venue: lab });
    await publish({ title: 'Robotics demo', venue: lab, startsAt: hoursFromNow(72), endsAt: hoursFromNow(74) });
    await publish({ title: 'Concert', venue: { name: 'Open Air Theatre', latitude: 26.509, longitude: 80.229 } });
    await publish({ title: 'Online talk', venue: { name: 'Zoom' } });
    await publish({ title: 'Ended', venue: lab, startsAt: hoursFromNow(-5), endsAt: hoursFromNow(-4) });
    await publish({ title: 'Draft', venue: lab, status: 'draft' });

    const res = await api().get('/api/events/venues').expect(200);
    assert.deepEqual(
      res.body.data.map((v) => [v.name, v.events.length]),
      [
        ['Innovation Lab', 2],
        ['Open Air Theatre', 1],
      ]
    );
    assert.deepEqual(
      res.body.data[0].events.map((e) => e.title),
      ['Hack night', 'Robotics demo']
    );
  });
});

describe('place search', () => {
  const realFetch = global.fetch;
  let calls: { url: string; options?: RequestInit }[];

  beforeEach(() => {
    calls = [];
    global.fetch = async (url: string | URL | Request, options?: RequestInit) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('127.0.0.1')) return realFetch(url, options); // supertest traffic
      return {
        ok: true,
        json: async () => [
          {
            place_id: 42,
            name: 'Main Auditorium',
            display_name: 'Main Auditorium, IIT Kanpur, India',
            lat: '26.5123',
            lon: '80.2329',
          },
        ],
      } as Response;
    };
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('requires sign-in and a meaningful query', async () => {
    await api().get('/api/places/search?q=auditorium').expect(401);
    const { auth } = await createUser();
    await api().get('/api/places/search?q=ab').set(auth).expect(400);
  });

  it('returns normalised places from OpenStreetMap, with an identifying User-Agent, and caches them', async () => {
    const { auth } = await createUser();
    const res = await api().get('/api/places/search?q=Main%20Auditorium%20Kanpur').set(auth).expect(200);
    assert.deepEqual(res.body.data, [
      { id: '42', name: 'Main Auditorium', address: 'Main Auditorium, IIT Kanpur, India', latitude: 26.5123, longitude: 80.2329 },
    ]);
    const outbound = calls.filter((c) => c.url.includes('nominatim'));
    assert.equal(outbound.length, 1);
    assert.match((outbound[0].options?.headers as Record<string, string>)['User-Agent'], /^Sync\//);

    await api().get('/api/places/search?q=main%20auditorium%20kanpur').set(auth).expect(200);
    assert.equal(calls.filter((c) => c.url.includes('nominatim')).length, 1, 'second lookup is served from cache');
  });

  it('reports a friendly error when the place service is down', async () => {
    global.fetch = async (url, options) => {
      if (String(url).includes('127.0.0.1')) return realFetch(url, options);
      throw new Error('network down');
    };
    const { auth } = await createUser();
    const res = await api().get('/api/places/search?q=somewhere%20new').set(auth).expect(503);
    assert.equal(res.body.error.code, 'PLACES_UNAVAILABLE');
  });
});

describe('local development CORS', () => {
  it('accepts the web app on any localhost port outside production', async () => {
    const res = await api().get('/api/meta').set('Origin', 'http://localhost:3001');
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:3001');
  });
});
