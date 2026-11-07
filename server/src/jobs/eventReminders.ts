import { Event, Registration } from '../models';
import logger from '../lib/logger';
import env from '../config/env';
import * as notifications from '../modules/notifications/notifications.service';
import { EVENT_VISIBILITY, EVENT_STATUS, REGISTRATION_STATUS, NOTIFICATION_TYPES } from '../constants';

const REMIND_BEFORE_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 5 * 60 * 1000;

/** "Saturday 8 November, 10:00 am IST" in the campus time zone. */
export function formatCampusTime(date: Date, timeZone = env.campusTimeZone): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}

/** Reminds each confirmed attendee once, within 24 hours of the event starting. */
export async function sendDueReminders(now = new Date()): Promise<number> {
  const events = await Event.find({
    visibility: EVENT_VISIBILITY.PUBLIC,
    status: EVENT_STATUS.PUBLISHED,
    startsAt: { $gt: now, $lte: new Date(now.getTime() + REMIND_BEFORE_MS) },
  }).select('title startsAt');

  let sent = 0;
  for (const event of events) {
    const due = await Registration.find({
      event: event._id,
      status: REGISTRATION_STATUS.GOING,
      reminderSentAt: null,
    }).select('user');
    if (!due.length) continue;

    // Mark first so a slow email provider can never cause duplicate reminders.
    await Registration.updateMany({ _id: { $in: due.map((r) => r._id) } }, { $set: { reminderSentAt: now } });

    await notifications.notify(
      due.map((r) => r.user),
      {
        type: NOTIFICATION_TYPES.EVENT_REMINDER,
        title: `Reminder: ${event.title}`,
        // The real start time, not "in N hours": the email may be read much later.
        body: `Starts ${formatCampusTime(event.startsAt)}.`,
        eventId: event._id,
      },
      { email: true }
    );
    sent += due.length;
  }
  return sent;
}

/** In-process timer for long-running servers. Returns a function that stops it. */
export function startEventReminders(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await sendDueReminders();
      if (sent) logger.info({ sent }, 'Sent event reminders');
    } catch (err) {
      logger.error({ err }, 'Event reminder job failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
