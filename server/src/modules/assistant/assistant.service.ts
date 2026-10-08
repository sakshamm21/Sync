/**
 * "Ask Sync": a chat assistant that answers questions about campus events and
 * the user's own schedule, grounded in real data through tools, and helps with
 * general questions too.
 *
 * The server is stateless: the client sends the recent conversation each time,
 * which keeps it working on serverless hosts (Vercel) with no extra storage.
 */
import type { UserDocument } from '../../models';
import { complete, type ChatMessage } from '../../lib/ai';
import { CATEGORY_VALUES } from '../../constants';
import type { PresentedEvent } from '../events/events.policy';
import { TOOL_DEFINITIONS, runTool, type ToolContext } from './assistant.tools';

/** How many model ↔ tool round trips one question may take before we ask for a final answer. */
const MAX_TOOL_ROUNDS = 5;
const MAX_EVENT_CARDS = 6;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  reply: string;
  /** Events the reply links to, in the order mentioned, for the client to show as cards. */
  events: PresentedEvent[];
}

function systemPrompt(user: UserDocument, timeZone: string): string {
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date());

  return `You are the friendly assistant built into Sync, a campus event platform. Users call you Sync too.

Right now it is ${now} in the user's time zone (${timeZone}).
You are talking to ${user.name} (role: ${user.role}${user.interests.length ? `; interests: ${user.interests.join(', ')}` : ''}).

How to help:
- For anything about events, schedules, venues or what's on, ALWAYS use the tools. Never invent events, times or places.
- When the user mentions a period ("this weekend", "tomorrow evening"), work out the exact dates from the current time above and pass them to the tools with the user's UTC offset.
- Event categories are: ${CATEGORY_VALUES.join(', ')}.
- When you mention an event, link it in Markdown using the "link" the tool gave you, e.g. [Tech Summit 2026](/events/abc123). Use the "when" text the tool gave you for times.
- You can only read. You cannot register, cancel or change anything: point the user to the event's page for that.
- You may also help with general questions (planning, writing an event description, study tips), briefly.
- Keep answers short and scannable: a sentence or two, or a short bulleted list. Use **bold** sparingly. No tables or headings.
- If the tools find nothing, say so plainly and suggest a broader search.`;
}

function finish(content: string | null, context: ToolContext): AssistantReply {
  const reply = content?.trim() || "Sorry, I couldn't come up with an answer to that. Could you rephrase it?";
  const ids = [...new Set([...reply.matchAll(/\/events\/([a-f\d]{24})/gi)].map((m) => m[1]))];
  const events = ids
    .map((id) => context.seen.get(id))
    .filter((event): event is PresentedEvent => Boolean(event))
    .slice(0, MAX_EVENT_CARDS);
  return { reply, events };
}

export async function chat(
  user: UserDocument,
  { messages, timeZone }: { messages: ConversationMessage[]; timeZone: string }
): Promise<AssistantReply> {
  const context: ToolContext = { user, timeZone, seen: new Map() };
  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt(user, timeZone) },
    ...messages.map(({ role, content }): ChatMessage => (role === 'user' ? { role, content } : { role, content })),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const message = await complete(history, TOOL_DEFINITIONS);
    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) return finish(message.content, context);

    history.push(message);
    for (const call of toolCalls) {
      const result = await runTool(call, context);
      history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // Still calling tools after several rounds: ask for an answer from what it has.
  const final = await complete(history, []);
  return finish(final.content, context);
}
