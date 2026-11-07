/**
 * Minimal client for any OpenAI-compatible Chat Completions API: Google Gemini
 * (the free default), OpenAI, Groq, OpenRouter, Ollama and others all speak it.
 * Switching provider is a matter of AI_BASE_URL + AI_MODEL + AI_API_KEY.
 */
import env from '../config/env';
import logger from './logger';
import { AppError } from './errors';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * A model turn exactly as the provider sent it. Providers may add their own
 * fields (Gemini 3 attaches "thought signatures" to tool calls), and they
 * expect them back unchanged, so the whole object is kept and resent.
 */
export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
  [providerField: string]: unknown;
}

export type ChatMessage =
  { role: 'system' | 'user'; content: string } | AssistantMessage | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface CompletionResponse {
  choices?: { message?: Partial<AssistantMessage> }[];
}

const REQUEST_TIMEOUT_MS = 30_000;

const unavailable = (message = 'The assistant is unavailable right now. Please try again in a moment.') =>
  new AppError(503, message, 'ASSISTANT_UNAVAILABLE');

/** One model turn: returns the assistant's reply, which may ask for tool calls. */
export async function complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<AssistantMessage> {
  if (!env.ai.enabled) {
    throw new AppError(503, 'The AI assistant is not set up on this server.', 'ASSISTANT_DISABLED');
  }

  let response: Response;
  try {
    response = await fetch(`${env.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ai.apiKey}` },
      body: JSON.stringify({
        model: env.ai.model,
        messages,
        // Some providers reject an empty tool list, so leave it out entirely.
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'AI provider unreachable');
    throw unavailable();
  }

  if (!response.ok) {
    // Never forward the provider's body: it can echo request details.
    logger.warn({ status: response.status, body: (await response.text()).slice(0, 500) }, 'AI provider returned an error');
    if (response.status === 429) {
      throw new AppError(429, 'The assistant is busy right now. Please try again in a minute.', 'ASSISTANT_BUSY');
    }
    throw unavailable();
  }

  const data = (await response.json()) as CompletionResponse;
  const message = data.choices?.[0]?.message;
  if (!message) throw unavailable();
  return { ...message, role: 'assistant', content: message.content ?? null };
}
