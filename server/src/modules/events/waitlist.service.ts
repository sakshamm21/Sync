/**
 * Waitlist promotion and schedule-clash detection.
 *
 * Promotion is kept separate from the request path because it emails everyone
 * it moves; see `jobs/outbox.ts` for how those emails are decoupled.
 */
import type { Types } from 'mongoose';
import { Event, Registration, type EventDocument, type UserDocument } from '../../models';
import * as notifications from '../notifications/notifications.service';
import { EVENT_STATUS, REGISTRATION_STATUS, NOTIFICATION_TYPES, type RegistrationStatus } from '../../constants';
import { claimSeat, releaseSeat } from './seats';

/** A confirmed event the user already has in their calendar. */
export interface Clash {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Confirmed events the user is already attending that overlap this one.
 * Back-to-back is fine, so only a real overlap counts.
 */
export async function clashesWith(user: UserDocument, event: EventDocument): Promise<Clash[]> {
  const registeredIds: Types.ObjectId[] = await Registration.find({
    user: user.id,
    status: REGISTRATION_STATUS.GOING,
  }).distinct('event');

  const overlapping = await Event.find({
    _id: { $in: registeredIds, $ne: event._id },
    // A cancelled event is no longer happening, so it can't clash.
    status: EVENT_STATUS.PUBLISHED,
    startsAt: { $lt: event.endsAt },
    endsAt: { $gt: event.startsAt },
  })
    .select('title startsAt endsAt')
    .sort({ startsAt: 1 })
    .limit(5);

  return overlapping.map((e) => ({
    id: e.id as string,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
  }));
}

/**
 * Moves people off the waitlist, first come first served, while seats are free.
 * Returns the users who were promoted so the caller can tell them.
 */
export async function fillFromWaitlist(event: EventDocument): Promise<Types.ObjectId[]> {
  if (!event.isOpenForRegistration()) return [];
  const promoted: Types.ObjectId[] = [];

  while (await Registration.exists({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED })) {
    if (!(await claimSeat(event._id))) break;
    const next = await Registration.findOneAndUpdate(
      { event: event._id, status: REGISTRATION_STATUS.WAITLISTED },
      { $set: { status: REGISTRATION_STATUS.GOING } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!next) {
      await releaseSeat(event._id);
      break;
    }
    promoted.push(next.user);
  }

  if (!promoted.length) return promoted;

  await notifications.notify(
    promoted,
    {
      type: NOTIFICATION_TYPES.WAITLIST_PROMOTED,
      title: `You're in: ${event.title}`,
      body: 'A spot opened up and you have been moved off the waitlist.',
      eventId: event._id,
    },
    { email: true }
  );
  return promoted;
}

export type { RegistrationStatus };