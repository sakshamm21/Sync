/**
 * Posting a club's new events to its Discord server or Slack channel
 * (Roadmap "Later": integrations). Only official webhook hosts are allowed,
 * so this can't be pointed at arbitrary internal addresses.
 */
import logger from './logger';

const ALLOWED = [
  /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/,
  /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/,
];

export const isAllowedWebhook = (url: string) => ALLOWED.some((re) => re.test(url));

type Sender = (url: string, body: unknown) => Promise<void>;
let testSender: Sender | null = null;
/** Tests only: capture webhook posts. */
export function setTestWebhookSender(sender: Sender | null) {
  testSender = sender;
}

/** Discord and Slack both take a JSON body; the shape differs a little. */
export async function postEventWebhook(
  url: string,
  event: { title: string; when: string; where: string; link: string; host: string }
) {
  const text = `**${event.title}**\n${event.when}${event.where ? ` · ${event.where}` : ''}\nby ${event.host}\n${event.link}`;
  const body = url.includes('hooks.slack.com')
    ? { text: text.replace(/\*\*/g, '*') }
    : { content: text, allowed_mentions: { parse: [] } };
  try {
    if (testSender) return await testSender(url, body);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) logger.warn({ status: res.status }, 'Club webhook refused the post');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Club webhook failed');
  }
}
