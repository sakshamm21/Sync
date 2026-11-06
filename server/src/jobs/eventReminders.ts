import { Event, Interest, Registration } from '../models';
import logger from '../lib/logger';
import { formatCampusTime } from '../lib/campusTime';

export { formatCampusTime };
import * as notifications from '../modules/notifications/notifications.service';
import { EVENT_VISIBILITY, EVENT_STATUS, REGISTRATION_STATUS, NOTIFICATION_TYPES } from '../constants';

const REMIND_BEFORE_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 5 * 60 * 1000;

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
    if (due.length) {
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

    // A gentler nudge, in the app only, for people who bookmarked it but haven't RSVPed.
    const registered = await Registration.find({ event: event._id }).distinct('user');
    const curious = await Interest.find({ event: event._id, reminderSentAt: null, user: { $nin: registered } }).select('user');
    if (curious.length) {
      await Interest.updateMany({ _id: { $in: curious.map((i) => i._id) } }, { $set: { reminderSentAt: now } });
      await notifications.notify(
        curious.map((i) => i.user),
        {
          type: NOTIFICATION_TYPES.EVENT_REMINDER,
          title: `Still interested? ${event.title}`,
          body: `Starts ${formatCampusTime(event.startsAt)}. Tap "I'm in" to grab a spot.`,
          eventId: event._id,
        }
      );
      sent += curious.length;
    }
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
