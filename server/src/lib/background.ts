/**
 * Work that should finish after the response has been sent.
 *
 * On Vercel a function can be frozen as soon as it responds, so background
 * promises are handed to `waitUntil`, which keeps the function alive until they
 * settle. On a long-running host they simply run in-process. Tests can await
 * everything still running with `settleBackground()`.
 */
import { waitUntil } from '@vercel/functions';
import logger from './logger';

const pending = new Set<Promise<unknown>>();

export function runInBackground(label: string, work: () => Promise<unknown>): void {
  const task = Promise.resolve()
    .then(work)
    .catch((err) => logger.error({ err, label }, 'Background task failed'))
    .finally(() => pending.delete(task));
  pending.add(task);
  if (process.env.VERCEL) waitUntil(task);
}

/** Resolves once every background task started so far has finished. */
export async function settleBackground(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
