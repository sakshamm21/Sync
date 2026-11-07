/**
 * The tools the AI assistant can call. Each one is a thin, read-only wrapper
 * over an existing service, so the assistant sees exactly what the user is
 * allowed to see (private events stay private) and never changes anything.
 * The one exception, `propose_action`, still changes nothing: it puts a
 * button in front of the user, who confirms it through the normal API.
 *
 * The zod schema of each tool is both the JSON Schema the model is shown and
 * the validator for the arguments it sends back.
 */
import { z } from 'zod';
import type { UserDocument } from '../../models';
import type { ToolCall, ToolDefinition } from '../../lib/ai';
import { AppError } from '../../lib/errors';
import { objectId } from '../../lib/schemas';
import * as events from '../events/events.service';
import { calendarRange } from '../events/events.schemas';
import type { PresentedEvent } from '../events/events.policy';
import { CATEGORY_VALUES } from '../../constants';

/** Something the assistant suggests doing; the user has to confirm it. */
export interface ProposedAction {
  type: 'rsvp' | 'cancel_rsvp' | 'interested';
  eventId: string;
  title: string;
  when: string;
}

export interface ToolContext {
  user: UserDocument;
  timeZone: string;
  /** Every event a tool returned, so the reply can show cards for the ones it mentions. */
  seen: Map<string, PresentedEvent>;
  /** Actions proposed during this reply, shown as confirm buttons. */
  proposals?: ProposedAction[];
}

const isoDate = (what: string) =>
  z.string().describe(`${what}, as an ISO 8601 date-time with a UTC offset, e.g. 2026-10-03T00:00:00+05:30`);

const schemas = {
  search_events: z.object({
    query: z.string().max(100).optional().describe('Words to match in the title, description, venue or tags'),
    category: z.enum(CATEGORY_VALUES).optional(),
    from: isoDate('Only events starting at or after this time').optional(),
    to: isoDate('Only events starting at or before this time').optional(),
    sort: z.enum(['soonest', 'popular']).optional(),
    limit: z.number().int().min(1).max(10).optional().describe('How many events to return (default 6)'),
  }),
  get_my_schedule: z.object({
    from: isoDate('Start of the period'),
    to: isoDate('End of the period'),
  }),
  get_event_details: z.object({
    event_id: objectId.describe('The id of an event returned by another tool'),
  }),
  get_recommendations: z.object({}),
  propose_action: z.object({
    action: z
      .enum(['rsvp', 'cancel_rsvp', 'interested'])
      .describe('rsvp = "I\'m in"; cancel_rsvp = give up their place; interested = bookmark'),
    event_id: objectId.describe('The id of an event returned by another tool'),
  }),
};

type ToolName = keyof typeof schemas;

const descriptions: Record<ToolName, string> = {
  search_events:
    'Search upcoming public events on campus. Use it for any question about what is happening, when or where. Returns at most 10 events.',
  get_my_schedule:
    "The signed-in user's own calendar for a period: events they registered for, are waitlisted for, organise, or planned privately.",
  get_event_details: 'Full details of one event, including its description, venue, organiser and seats left.',
  get_recommendations: "Upcoming events picked for the user from their interests and what's popular, excluding ones they joined.",
  propose_action:
    'Offer to do something for the user: RSVP, cancel an RSVP, or mark an event as interested. It does NOT do it: the user sees a button and confirms. Use it when the user asks you to sign them up, cancel, or save an event.',
};

function toParameters(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: 'input' });
  return json;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = (Object.keys(schemas) as ToolName[]).map((name) => ({
  type: 'function',
  function: { name, description: descriptions[name], parameters: toParameters(schemas[name]) },
}));

/** "Sat 4 Oct, 10:00 – 16:00" in the user's time zone, so the model never does time-zone maths. */
function formatWhen(start: Date, end: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
  const sameDay = day.format(start) === day.format(end);
  return sameDay
    ? `${day.format(start)}, ${time.format(start)} – ${time.format(end)}`
    : `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}`;
}

/** The compact view of an event the model reads (it never needs every field). */
function summarize(event: PresentedEvent, context: ToolContext, { detailed = false } = {}) {
  context.seen.set(event.id, event);
  const owner = event.owner as { name?: string; organization?: string } | null;
  const venue = [event.venue?.name, event.venue?.address].filter(Boolean).join(', ');
  return {
    id: event.id,
    link: `/events/${event.id}`,
    title: event.title,
    category: event.category,
    tags: event.tags,
    when: formatWhen(new Date(event.startsAt), new Date(event.endsAt), context.timeZone),
    venue: venue || null,
    online: Boolean(event.onlineUrl),
    organizer: owner?.organization || owner?.name || null,
    visibility: event.visibility,
    status: event.status,
    attendees: event.attendeeCount,
    spotsLeft: event.spotsLeft,
    myRegistration: event.viewer.registration,
    iAmOrganizer: event.viewer.isOwner,
    ...(detailed ? { description: event.description.slice(0, 1500) } : {}),
  };
}

const parseDate = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `"${value}" is not a valid date-time`);
  return date;
};

const handlers: { [Name in ToolName]: (args: z.output<(typeof schemas)[Name]>, context: ToolContext) => Promise<unknown> } = {
  async search_events({ query, category, from, to, sort, limit }, context) {
    const { items, meta } = await events.listPublic(context.user, {
      q: query,
      category,
      from: parseDate(from),
      to: parseDate(to),
      sort: sort ?? 'soonest',
      includePast: false,
      hasSpots: false,
      online: false,
      page: 1,
      limit: limit ?? 6,
    });
    return { total: meta.total, events: items.map((e) => summarize(e, context)) };
  },

  async get_my_schedule({ from, to }, context) {
    const range = calendarRange.parse({ from: parseDate(from), to: parseDate(to) });
    const items = await events.calendarFor(context.user, range);
    return { events: items.map((e) => summarize(e, context)) };
  },

  async get_event_details({ event_id }, context) {
    return summarize(await events.getForViewer(context.user, event_id), context, { detailed: true });
  },

  async get_recommendations(_args, context) {
    const items = await events.recommendedFor(context.user);
    return { events: items.map((e) => summarize(e, context)) };
  },

  async propose_action({ action, event_id }, context) {
    const event = await events.getForViewer(context.user, event_id);
    const registered = event.viewer.registration;
    // Only offer what would actually work, so the button never fails.
    if (event.visibility !== 'public' || event.status !== 'published' || event.isPast) {
      return { error: 'That event is not open for RSVPs.' };
    }
    if (event.viewer.isOrganizer) return { error: 'The user is organising this event.' };
    if (action === 'rsvp' && registered) return { error: `They already have a place (${registered}).` };
    if (action === 'cancel_rsvp' && !registered) return { error: 'They are not registered for it.' };
    if (action === 'interested' && event.viewer.interested) return { error: 'It is already saved as interested.' };
    summarize(event, context);
    const proposal: ProposedAction = {
      type: action,
      eventId: event.id,
      title: event.title,
      when: formatWhen(new Date(event.startsAt), new Date(event.endsAt), context.timeZone),
    };
    context.proposals = [...(context.proposals ?? []).filter((p) => p.eventId !== event.id || p.type !== action), proposal];
    return {
      proposed: true,
      note: 'A confirm button is shown under your reply. Tell the user to tap it; do not claim it is done.',
    };
  },
};

/**
 * Runs one tool call. Problems (bad arguments, an event that doesn't exist)
 * are returned to the model as `{ error }` so it can recover or explain,
 * rather than failing the whole conversation.
 */
export async function runTool(call: ToolCall, context: ToolContext): Promise<unknown> {
  const name = call.function?.name as ToolName;
  // `in` would also accept inherited keys such as "constructor".
  if (!Object.hasOwn(schemas, name)) return { error: `Unknown tool "${call.function?.name}"` };

  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { error: 'Arguments were not valid JSON' };
  }
  const parsed = schemas[name].safeParse(args);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };

  try {
    const handler = handlers[name] as (args: unknown, context: ToolContext) => Promise<unknown>;
    return await handler(parsed.data, context);
  } catch (err) {
    if (err instanceof AppError || err instanceof z.ZodError) return { error: err.message };
    throw err;
  }
}
