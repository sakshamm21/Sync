/**
 * Self-healing maintenance. `Event.attendeeCount` is a denormalised cache that
 * keeps RSVP fast, but if a process ever dies between taking a seat and
 * writing the registration, the counter drifts and the seat is lost forever.
 * These jobs recompute it from the registrations that actually exist.
 */
import { Event, Registration, Notification, OutboxEmail } from '../models';
import logger from '../lib/logger';

const CHECK_EVERY_MS = 60 * 60 * 1000;
/** Never touch more than this many events per run, to bound the work. */
const MAX_EVENTS = 500;

/**
 * Sets every event's `attendeeCount` to the number of confirmed
 * registrations, and reports how many events were corrected.
 */
export async function recountAttendees(now = new Date()): Promise<number> {
  // Only public events with a capacity use the counter for anything.
  const events = await Event.find({ capacity: { $ne: null } }).select('_id attendeeCount').limit(MAX_EVENTS);
  if (!events.length) return 0;

  const counts = await Registration.aggregate([
    { $match: { status: 'going' } },
    { $group: { _id: '$event', count: { $sum: 1 } } },
  ]);
  const byEvent = new Map(counts.map((c) => [String(c._id), c.count as number]));

  const drift: { eventId: string; was: number; now: number }[] = [];
  const writes: Promise<unknown>[] = [];

  for (const event of events) {
    const actual = byEvent.get(String(event._id)) ?? 0;
    if (event.attendeeCount === actual) continue;
    drift.push({ eventId: event.id, was: event.attendeeCount, now: actual });
    writes.push(Event.updateOne({ _id: event._id }, { $set: { attendeeCount: actual } }));
  }

  if (drift.length) {
    await Promise.all(writes);
    logger.warn({ drift }, 'Corrected attendeeCount drift');
  }
  return drift.length;
}

/**
 * Housekeeping for rows nothing will ever read again: delivered outbox
 * entries, notifications the user has seen, and past events' chats.
 */
export async function pruneOldData(now = new Date()): Promise<{ emails: number; notifications: number }> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [emails, notifications] = await Promise.all([
    OutboxEmail.deleteMany({ sentAt: { $lt: thirtyDaysAgo } }),
    // Unread notifications are kept; only ones already read are dropped.
      // `$exists: true` rather than `$ne: null`, because an unread notification
      // stores `readAt` as absent or null depending on how it was written.
      Notification.deleteMany({
        readAt: { $exists: true, $ne: null },
        createdAt: { $lt: ninetyDaysAgo },
      }),
    ]);

  return { emails: emails.deletedCount ?? 0, notifications: notifications.deletedCount ?? 0 };
}

/** In-process timer for long-running servers. Returns a function that stops it. */
export function startMaintenanceJobs(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const corrected = await recountAttendees();
      if (corrected) logger.info({ corrected }, 'Reconciled attendee counts');
      await pruneOldData();
    } catch (err) {
      logger.error({ err }, 'Maintenance job failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  // Give the server a moment to finish booting before the first pass.
  setTimeout(() => void tick(), 10_000).unref();
  return () => clearInterval(timer);
}