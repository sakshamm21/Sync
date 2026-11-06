/**
 * Self-healing maintenance. `Event.attendeeCount` is a denormalised cache that
 * keeps RSVP fast, but if a process ever dies between taking a seat and
 * writing the registration, the counter drifts and the seat is lost forever.
 * These jobs recompute it from the registrations that actually exist.
 */
import { Event, Registration, Notification, OutboxEmail } from '../models';
import { fillFromWaitlist } from '../modules/events/waitlist.service';
import { EVENT_STATUS, REGISTRATION_STATUS } from '../constants';
import logger from '../lib/logger';

const CHECK_EVERY_MS = 60 * 60 * 1000;
/** Events are checked in pages of this size, so one run never loads them all at once. */
const PAGE_SIZE = 200;

/**
 * Sets each capped event's `attendeeCount` to the number of confirmed
 * registrations, then fills any seats that were wrongly shown as taken from
 * the waitlist. Returns how many events were corrected.
 *
 * Only events that haven't ended are checked: a finished event's counter is
 * never used to hand out seats again. Each write is conditional on the old
 * value, so an RSVP that lands mid-recount wins and the event is simply
 * checked again next run.
 */
export async function recountAttendees(now = new Date()): Promise<number> {
  const drift: { eventId: string; was: number; now: number }[] = [];
  let promoted = 0;
  let lastId: unknown = null;

  for (;;) {
    const events = await Event.find({
      capacity: { $ne: null },
      endsAt: { $gte: now },
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    })
      .sort({ _id: 1 })
      .limit(PAGE_SIZE);
    if (!events.length) break;
    lastId = events[events.length - 1]._id;

    const counts = await Registration.aggregate<{ _id: unknown; count: number }>([
      { $match: { event: { $in: events.map((e) => e._id) }, status: REGISTRATION_STATUS.GOING } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);
    const byEvent = new Map(counts.map((c) => [String(c._id), c.count]));

    for (const event of events) {
      const actual = byEvent.get(String(event._id)) ?? 0;
      if (event.attendeeCount !== actual) {
        const fixed = await Event.updateOne(
          { _id: event._id, attendeeCount: event.attendeeCount },
          { $set: { attendeeCount: actual } }
        );
        if (fixed.modifiedCount !== 1) continue;
        drift.push({ eventId: event.id, was: event.attendeeCount, now: actual });
        event.attendeeCount = actual;
      }
      // A seat that is free while people wait means a promotion was missed.
      if (event.status === EVENT_STATUS.PUBLISHED && event.capacity != null && event.attendeeCount < event.capacity) {
        promoted += (await fillFromWaitlist(event)).length;
      }
    }
    if (events.length < PAGE_SIZE) break;
  }

  if (drift.length) logger.warn({ drift }, 'Corrected attendeeCount drift');
  if (promoted) logger.info({ promoted }, 'Promoted people off waitlists after a recount');
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