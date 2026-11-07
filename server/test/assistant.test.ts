import './assistant.env';

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, resetDatabase, api, createUser, eventInput, hoursFromNow } from './helpers';

before(startDatabase);
after(stopDatabase);
beforeEach(resetDatabase);

/** What the fake model answers on each turn, given the request it received. */
type Turn = (request: any) => Record<string, unknown>;

/**
 * Stands in for the AI provider: answers chat completion requests with
 * scripted turns and records every request. Other traffic passes through.
 */
function fakeProvider(turns: Turn[], { status = 200 } = {}) {
  const realFetch = global.fetch;
  const requests: any[] = [];

  global.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    if (!String(url).startsWith('https://ai.test/')) return realFetch(url, options);
    assert.equal(String(url), 'https://ai.test/v1/chat/completions');
    const body = JSON.parse(String(options?.body));
    requests.push({ body, headers: options?.headers });
    if (status !== 200) return new Response('{"error":"nope"}', { status });
    const turn = turns[requests.length - 1];
    assert.ok(turn, `unexpected model call #${requests.length}`);
    return Response.json({ choices: [{ message: { role: 'assistant', ...turn(body) } }] });
  };

  return { requests, restore: () => (global.fetch = realFetch) };
}

const toolCall = (name: string, args: Record<string, unknown>, id = 'call_1') => ({
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

/** The tool result the model was sent in its latest request. */
const lastToolResult = (request: any) => JSON.parse(request.messages.at(-1).content);

const ask = (auth: Record<string, string>, question: string) =>
  api()
    .post('/api/assistant/chat')
    .set(auth)
    .send({ messages: [{ role: 'user', content: question }], timeZone: 'Asia/Kolkata' });

describe('AI assistant', () => {
  let provider: ReturnType<typeof fakeProvider> | undefined;
  afterEach(() => provider?.restore());

  it('is advertised in /api/meta and requires sign-in', async () => {
    const meta = await api().get('/api/meta').expect(200);
    assert.equal(meta.body.data.assistant, true);
    await api()
      .post('/api/assistant/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(401);
  });

  it('answers from real events found with tools, and returns cards for the ones it links', async () => {
    const organizer = await createUser({ role: 'organizer', organization: 'Robotics Club' });
    const member = await createUser();
    const hackathon = (
      await api()
        .post('/api/events')
        .set(organizer.auth)
        .send(eventInput({ title: 'Robo Hackathon' }))
    ).body.data;
    await api()
      .post('/api/events')
      .set(organizer.auth)
      .send(eventInput({ title: 'Poetry Night', category: 'cultural' }));

    provider = fakeProvider([
      () => toolCall('search_events', { query: 'hackathon' }),
      (request) => {
        const result = lastToolResult(request);
        const [event] = result.events;
        return { content: `Try [${event.title}](${event.link}) on ${event.when}.` };
      },
    ]);

    const res = await ask(member.auth, 'Any hackathons coming up?').expect(200);

    // The model was given the tools, the user's time zone, and only matching events.
    const [first, second] = provider.requests;
    assert.equal(first.body.model, 'test-model');
    assert.deepEqual(
      first.body.tools.map((t: any) => t.function.name),
      ['search_events', 'get_my_schedule', 'get_event_details', 'get_recommendations', 'propose_action']
    );
    assert.match(first.body.messages[0].content, /Asia\/Kolkata/);
    assert.equal((first.headers as Record<string, string>).Authorization, 'Bearer test-key');
    const result = lastToolResult(second.body);
    assert.deepEqual(
      result.events.map((e: any) => e.title),
      ['Robo Hackathon']
    );
    assert.equal(result.events[0].organizer, 'Robotics Club');

    assert.match(res.body.data.reply, new RegExp(`\\[Robo Hackathon\\]\\(/events/${hackathon.id}\\)`));
    assert.deepEqual(
      res.body.data.events.map((e: any) => e.id),
      [hackathon.id]
    );
    assert.equal(res.body.data.events[0].viewer.registration, null);
  });

  it("reads the user's own schedule, private plans included, but never other people's", async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const other = await createUser();
    const talk = (
      await api()
        .post('/api/events')
        .set(organizer.auth)
        .send(eventInput({ title: 'AI Talk' }))
    ).body.data;
    await api().post(`/api/events/${talk.id}/registration`).set(member.auth).expect(200);
    await api()
      .post('/api/events')
      .set(member.auth)
      .send(eventInput({ title: 'Dentist' }))
      .expect(201);
    await api()
      .post('/api/events')
      .set(other.auth)
      .send(eventInput({ title: 'Someone else’s plan' }))
      .expect(201);

    provider = fakeProvider([
      () => toolCall('get_my_schedule', { from: hoursFromNow(0), to: hoursFromNow(24 * 7) }),
      () => ({ content: 'You have two things this week.' }),
    ]);
    await ask(member.auth, "What's on my calendar this week?").expect(200);

    const result = lastToolResult(provider.requests[1].body);
    assert.deepEqual(result.events.map((e: any) => [e.title, e.myRegistration, e.visibility]).sort(), [
      ['AI Talk', 'going', 'public'],
      ['Dentist', null, 'private'],
    ]);
  });

  it('lets the model recover from a bad tool call instead of failing', async () => {
    const member = await createUser();
    provider = fakeProvider([
      () => toolCall('get_event_details', { event_id: 'not-an-id' }),
      (request) => ({ content: `Sorry: ${lastToolResult(request).error}` }),
    ]);
    const res = await ask(member.auth, 'Tell me about that event').expect(200);
    assert.match(res.body.data.reply, /Invalid id/);
    assert.deepEqual(res.body.data.events, []);
  });

  it('never shows a draft or private event to someone who cannot see it', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const draft = (
      await api()
        .post('/api/events')
        .set(organizer.auth)
        .send(eventInput({ title: 'Secret', status: 'draft' }))
    ).body.data;

    provider = fakeProvider([
      () => toolCall('get_event_details', { event_id: draft.id }),
      (request) => ({ content: JSON.stringify(lastToolResult(request)) }),
    ]);
    const res = await ask(member.auth, 'details?').expect(200);
    assert.match(res.body.data.reply, /Event not found/);
  });

  it('offers actions as confirm buttons instead of doing them', async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (
      await api()
        .post('/api/events')
        .set(organizer.auth)
        .send(eventInput({ title: 'Rust Workshop' }))
    ).body.data;

    provider = fakeProvider([
      () => toolCall('propose_action', { action: 'rsvp', event_id: event.id }),
      (request) => {
        assert.equal(lastToolResult(request).proposed, true);
        return { content: `Tap the button to join [Rust Workshop](/events/${event.id}).` };
      },
    ]);
    const res = await ask(member.auth, 'Sign me up for the Rust workshop').expect(200);
    assert.deepEqual(
      res.body.data.actions.map((a: any) => [a.type, a.eventId, a.title]),
      [['rsvp', event.id, 'Rust Workshop']]
    );
    // Nothing happened yet: the user confirms through the normal API.
    const view = (await api().get(`/api/events/${event.id}`).set(member.auth)).body.data;
    assert.equal(view.viewer.registration, null);
  });

  it("won't offer an action that would fail", async () => {
    const organizer = await createUser({ role: 'organizer' });
    const member = await createUser();
    const event = (await api().post('/api/events').set(organizer.auth).send(eventInput())).body.data;
    provider = fakeProvider([
      () => toolCall('propose_action', { action: 'cancel_rsvp', event_id: event.id }),
      (request) => {
        assert.match(lastToolResult(request).error, /not registered/);
        return { content: "You aren't signed up for that one." };
      },
    ]);
    const res = await ask(member.auth, 'Cancel my place').expect(200);
    assert.deepEqual(res.body.data.actions, []);
  });

  it('validates the conversation', async () => {
    const member = await createUser();
    const lastFromAssistant = await api()
      .post('/api/assistant/chat')
      .set(member.auth)
      .send({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      })
      .expect(400);
    assert.equal(lastFromAssistant.body.error.message, 'The last message must be from the user');

    const tooLong = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
    await api().post('/api/assistant/chat').set(member.auth).send({ messages: tooLong }).expect(400);
  });

  it('turns provider failures into friendly errors', async () => {
    const member = await createUser();
    provider = fakeProvider([], { status: 429 });
    const busy = await ask(member.auth, 'hi').expect(429);
    assert.equal(busy.body.error.code, 'ASSISTANT_BUSY');
    provider.restore();

    provider = fakeProvider([], { status: 500 });
    const down = await ask(member.auth, 'hi').expect(503);
    assert.equal(down.body.error.code, 'ASSISTANT_UNAVAILABLE');
  });

  it('stops calling tools after a few rounds and asks for a final answer', async () => {
    const member = await createUser();
    const loop = () => toolCall('get_recommendations', {});
    provider = fakeProvider([loop, loop, loop, loop, loop, () => ({ content: 'Here is what I found.' })]);
    const res = await ask(member.auth, 'Recommend something').expect(200);
    assert.equal(res.body.data.reply, 'Here is what I found.');
    assert.equal(provider.requests.length, 6);
    assert.equal(provider.requests[5].body.tools, undefined, 'the final request offers no tools');
  });
});
