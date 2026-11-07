/**
 * Email outbox. Work is written to `OutboxEmail` first and delivered
 * afterwards, so no student ever waits on an email provider to RSVP, and a
 * crash mid-send loses nothing.
 *
 * Queuing mail also starts a drain in the background (see lib/background.ts),
 * so on Vercel the email leaves within seconds of the request; the scheduled
 * job and the in-process timer are the safety net.
 */
import { OutboxEmail, type OutboxEmailDocument } from '../models';
import env from '../config/env';
import logger from '../lib/logger';
import { deliver, mailConfigured } from '../lib/mailer';
import { runInBackground } from '../lib/background';

export const MAX_ATTEMPTS = 5;
/** How long to wait after the 1st, 2nd, 3rd and 4th failure. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
/** Emails sent at the same time by one drain. */
const CONCURRENCY = 5;
/** One drain stops starting new sends after this long (functions time out at 60 s). */
const DEFAULT_BUDGET_MS = 45_000;
const CHECK_EVERY_MS = 30 * 1000;
/** A row claimed longer ago than this was abandoned by a dead process. */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export interface QueuedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Queues emails and starts delivering them in the background. */
export async function queueMail(...emails: QueuedEmail[]): Promise<void> {
  if (!emails.length) return;
  await OutboxEmail.insertMany(emails.map((e) => ({ ...e, attempts: 0 })));
  if (!mailConfigured() && !env.isProduction) {
    for (const e of emails) logger.info(`[mail preview, not sent] to ${e.to}: ${e.subject}\n${e.text}`);
  }
  scheduleDrain();
}

let drainScheduled = false;

/** Starts one background drain unless one is already on its way. */
export function scheduleDrain(): void {
  if (drainScheduled || !mailConfigured()) return;
  drainScheduled = true;
  runInBackground('email-outbox', async () => {
    try {
      await drainOutbox();
    } finally {
      drainScheduled = false;
    }
  });
}

/** Atomically claims the oldest email that is due, or returns null. */
async function claimNext(now: Date): Promise<OutboxEmailDocument | null> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  return OutboxEmail.findOneAndUpdate(
    {
      sentAt: null,
      failedAt: null,
      attempts: { $lt: MAX_ATTEMPTS },
      $and: [
        { $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
        { $or: [{ claimedAt: null }, { claimedAt: { $lte: staleBefore } }] },
      ],
    },
    // The claim counts the attempt, so a process that dies mid-send still uses one up.
    { $set: { claimedAt: now }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true }
  );
}

async function sendOne(row: OutboxEmailDocument): Promise<boolean> {
  const result = await deliver({ to: row.to, subject: row.subject, text: row.text ?? '', html: row.html });
  if (result.ok) {
    await OutboxEmail.updateOne({ _id: row._id }, { $set: { sentAt: new Date(), claimedAt: null, lastError: null } });
    return true;
  }
  if ('notConfigured' in result && result.notConfigured) {
    // Mail was switched off mid-drain: give the attempt back and leave the row queued.
    await OutboxEmail.updateOne({ _id: row._id }, { $set: { claimedAt: null }, $inc: { attempts: -1 } });
    return false;
  }
  const giveUp = !result.retryable || row.attempts >= MAX_ATTEMPTS;
  const backoff = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)];
  await OutboxEmail.updateOne(
    { _id: row._id },
    {
      $set: {
        claimedAt: null,
        lastError: result.error,
        ...(giveUp ? { failedAt: new Date() } : { nextAttemptAt: new Date(Date.now() + backoff) }),
      },
    }
  );
  if (giveUp) logger.warn({ to: row.to, subject: row.subject, attempts: row.attempts, error: result.error }, 'Gave up on an email');
  return false;
}

/**
 * Sends everything that is due, a few at a time, until the queue is empty or
 * the time budget runs out. Each row is claimed with a conditional update, so
 * two concurrent drains (or two serverless instances) never send the same
 * email twice. When no email service is configured it does nothing, and the
 * rows wait until one is.
 */
export async function drainOutbox({ budgetMs = DEFAULT_BUDGET_MS } = {}): Promise<number> {
  if (!mailConfigured()) return 0;
  const deadline = Date.now() + budgetMs;
  let sent = 0;

  const worker = async () => {
    while (Date.now() < deadline) {
      const row = await claimNext(new Date());
      if (!row) return;
      if (await sendOne(row)) sent += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return sent;
}

/** In-process timer for long-running servers. Returns a function that stops it. */
export function startOutboxDrainer(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await drainOutbox();
      if (sent) logger.info({ sent }, 'Delivered queued emails');
    } catch (err) {
      logger.error({ err }, 'Email outbox drain failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
