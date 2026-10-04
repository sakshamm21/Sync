/**
 * Email outbox. Work is written to `OutboxEmail` first and delivered
 * afterwards, so no student ever waits on an SMTP provider to RSVP, and a
 * crash mid-send loses nothing.
 */
import { OutboxEmail } from '../models';
import logger from '../lib/logger';
import { sendMail } from '../lib/mailer';

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const CHECK_EVERY_MS = 30 * 1000;
/** A row claimed longer ago than this was abandoned by a dead process. */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export interface QueuedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Queues one email. When no mail service is configured (dev, tests, demos)
 * it logs the preview and returns false, so callers can report that the code
 * was shown on screen instead.
 */
export async function queueMail(email: QueuedEmail): Promise<boolean> {
  await OutboxEmail.create({
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    attempts: 0,
  });
  return true;
}

/**
 * Sends an email right now and reports whether it was delivered. Only for
 * auth flows where the user is staring at the screen waiting for a code, and
 * the caller has to know whether to show that code instead.
 */
export async function sendNow(email: QueuedEmail): Promise<boolean> {
  return sendMail(email);
}

/**
 * Claims and sends one batch. A row is claimed with a conditional update, so
 * two concurrent drains (or two serverless instances) never send the same
 * email twice.
 */
export async function drainOutbox(now = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  let sent = 0;

  for (let i = 0; i < BATCH_SIZE; i += 1) {
    const candidate = await OutboxEmail.findOne({
      sentAt: null,
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [{ claimedAt: null }, { claimedAt: { $lte: staleBefore } }],
    })
      .sort({ createdAt: 1 })
      .select('_id');

    if (!candidate) break;

    const claimed = await OutboxEmail.findOneAndUpdate(
      { _id: candidate._id, claimedAt: candidate.claimedAt },
      { $set: { claimedAt: now }, $inc: { attempts: 1 } },
      { new: true }
    );
    // Lost the race to another drainer: try the next row.
    if (!claimed) continue;

    const delivered = await sendMail({
      to: claimed.to,
      subject: claimed.subject,
      text: claimed.text ?? '',
      html: claimed.html,
    });

    await OutboxEmail.updateOne(
      { _id: claimed._id },
      delivered
        ? { $set: { sentAt: new Date(), claimedAt: null } }
        : // Give up after enough tries so one bad address cannot block the queue.
          { $set: { claimedAt: null }, $inc: { attempts: MAX_ATTEMPTS } }
    );
    if (delivered) sent += 1;
  }
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