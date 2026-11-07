/** Inviting a friend to an event, and personal "remind me" nudges. */
import { Event, Reminder, Registration, type UserDocument } from '../../models';
import { badRequest, forbidden } from '../../lib/errors';
import * as notifications from '../notifications/notifications.service';
import { friendIdsOf } from '../friends/friends.service';
import { findViewableEvent } from './events.policy';
import { formatCampusTime } from '../../lib/campusTime';
import { EVENT_STATUS, EVENT_VISIBILITY, NOTIFICATION_TYPES } from '../../constants';

/** "Come with me": tells friends about an event (Roadmap "Next" #7). */
export async function inviteFriends(user: UserDocument, eventId: string, friendIds: string[]) {
  const event = await findViewableEvent(user, eventId);
  if (event.visibility !== EVENT_VISIBILITY.PUBLIC || event.status !== EVENT_STATUS.PUBLISHED || event.isPast) {
    throw badRequest('Only upcoming public events can be shared with friends');
  }
  const mine = new Set((await friendIdsOf(user._id)).map(String));
  const targets = friendIds.filter((id) => mine.has(id));
  if (!targets.length) throw forbidden('You can only invite your friends', 'NOT_FRIENDS');
  const already = new Set((await Registration.find({ event: event._id, user: { $in: targets } }).distinct('user')).map(String));
  const invite = targets.filter((id) => !already.has(id));
  await notifications.notify(invite, {
    type: NOTIFICATION_TYPES.EVENT_INVITE,
    title: `${user.name} invited you to ${event.title}`,
    body: `${formatCampusTime(event.startsAt)}. Tap to see it.`,
    eventId: event._id,
  });
  return { invited: invite.length, alreadyGoing: targets.length - invite.length };
}

/** Sets (or replaces) the user's own reminder for an event. */
export async function setReminder(user: UserDocument, eventId: string, minutesBefore: number) {
  const event = await findViewableEvent(user, eventId);
  const remindAt = new Date(event.startsAt.getTime() - minutesBefore * 60_000);
  if (remindAt <= new Date()) throw badRequest('That time has already passed', 'TOO_LATE');
  await Reminder.updateOne(
    { user: user._id, event: event._id },
    { $set: { remindAt, minutesBefore, sentAt: null } },
    { upsert: true }
  );
  return { minutesBefore, remindAt };
}

export async function clearReminder(user: UserDocument, eventId: string) {
  await Reminder.deleteOne({ user: user._id, event: eventId });
  return { minutesBefore: null };
}

export async function reminderFor(user: UserDocument, eventId: string) {
  const r = await Reminder.findOne({ user: user._id, event: eventId, sentAt: null });
  return { minutesBefore: r?.minutesBefore ?? null };
}

/** Sends personal reminders that are due. Run with the scheduled jobs (every 15 minutes). */
export async function sendPersonalReminders(now = new Date()): Promise<number> {
  let sent = 0;
  for (;;) {
    const due = await Reminder.findOneAndUpdate(
      { sentAt: null, remindAt: { $lte: now } },
      { $set: { sentAt: now } },
      { new: true }
    );
    if (!due) return sent;
    const event = await Event.findById(due.event).select('title startsAt status');
    if (!event || event.status === EVENT_STATUS.CANCELLED || event.startsAt < now) continue;
    await notifications.notify(
      [due.user],
      {
        type: NOTIFICATION_TYPES.EVENT_REMINDER,
        title: `Soon: ${event.title}`,
        body: `Starts ${formatCampusTime(event.startsAt)}.`,
        eventId: event._id,
      },
      { email: true }
    );
    sent += 1;
  }
}
