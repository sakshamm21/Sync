/**
 * Waitlist promotion and schedule-clash detection.
 *
 * Promotion is kept separate from the request path because it emails everyone
 * it moves; see `jobs/outbox.ts` for how those emails are decoupled.
 */
import type { Types } from 'mongoose';
import { Event, Registration, User, type EventDocument, type UserDocument } from '../../models';
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

type Promotion = { user: Types.ObjectId; offered: boolean };

/**
 * Gives the seat to the longest-waiting person: straight in, or as an offer
 * to claim within the event's claim window (unless they chose "take any seat
 * automatically"). The seat counts as taken either way. Null if nobody waits.
 */
async function promoteNext(event: EventDocument): Promise<Promotion | null> {
  for (;;) {
    const next = await Registration.findOne({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED }).sort({
      createdAt: 1,
      _id: 1,
    });
    if (!next) return null;
    const user = event.waitlistClaimHours ? await User.findById(next.user).select('preferences') : null;
    const offer = Boolean(event.waitlistClaimHours && !user?.preferences?.autoAcceptWaitlist);
    // Conditional on still being waitlisted, so two promotions never take the same person.
    const updated = await Registration.findOneAndUpdate(
      { _id: next._id, status: REGISTRATION_STATUS.WAITLISTED },
      {
        $set: offer
          ? { status: REGISTRATION_STATUS.OFFERED, offerExpiresAt: new Date(Date.now() + event.waitlistClaimHours! * 3600_000) }
          : { status: REGISTRATION_STATUS.GOING, offerExpiresAt: null },
      },
      { new: true }
    );
    if (updated) return { user: updated.user, offered: offer };
  }
}

async function tellPromoted(event: EventDocument, promoted: Promotion[]) {
  const movedIn = promoted.filter((p) => !p.offered).map((p) => p.user);
  const offered = promoted.filter((p) => p.offered).map((p) => p.user);
  if (movedIn.length) {
    await notifications.notify(
      movedIn,
      {
        type: NOTIFICATION_TYPES.WAITLIST_PROMOTED,
        title: `You're in: ${event.title}`,
        body: 'A spot opened up and you have been moved off the waitlist.',
        eventId: event._id,
      },
      { email: true }
    );
  }
  if (offered.length) {
    await notifications.notify(
      offered,
      {
        type: NOTIFICATION_TYPES.WAITLIST_OFFER,
        title: `Spot open: ${event.title}`,
        body: `A spot is being held for you. Claim it within ${event.waitlistClaimHours} hour${event.waitlistClaimHours === 1 ? '' : 's'} or it goes to the next person.`,
        eventId: event._id,
      },
      { email: true }
    );
  }
}

/**
 * A confirmed attendee has left. Their seat goes straight to the first person
 * on the waitlist, so the seat is never "free" in between and a brand-new RSVP
 * can't take it first. Only if nobody is waiting does the seat become free.
 *
 * This runs on the request path (not in the background) because on serverless
 * the function may be frozen as soon as the response is sent.
 */
export async function handOverSeat(event: EventDocument): Promise<Types.ObjectId | null> {
  const promoted = event.isOpenForRegistration() ? await promoteNext(event) : null;
  if (!promoted) {
    await releaseSeat(event._id);
    return null;
  }
  await tellPromoted(event, [promoted]);
  return promoted.user;
}

/**
 * Moves people off the waitlist, first come first served, while seats are free.
 * Used when capacity grows and by the maintenance job after a recount.
 * Returns the users who were promoted.
 */
export async function fillFromWaitlist(event: EventDocument): Promise<Types.ObjectId[]> {
  if (!event.isOpenForRegistration()) return [];
  const promoted: Promotion[] = [];

  while (await Registration.exists({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED })) {
    if (!(await claimSeat(event._id))) break;
    const next = await promoteNext(event);
    if (!next) {
      await releaseSeat(event._id);
      break;
    }
    promoted.push(next);
  }

  await tellPromoted(event, promoted);
  return promoted.map((p) => p.user);
}

/**
 * Offers nobody claimed in time: the person drops off the list (they're told)
 * and the seat passes to the next in line. Run by the scheduled jobs.
 */
export async function expireOffers(now = new Date()): Promise<number> {
  let expired = 0;
  for (;;) {
    const lapsed = await Registration.findOneAndDelete({ status: REGISTRATION_STATUS.OFFERED, offerExpiresAt: { $lte: now } });
    if (!lapsed) return expired;
    expired += 1;
    const event = await Event.findById(lapsed.event);
    await notifications.notify([lapsed.user], {
      type: NOTIFICATION_TYPES.WAITLIST_OFFER,
      title: `Offer expired: ${event?.title ?? 'an event'}`,
      body: 'The spot was held for you but not claimed in time, so it went to the next person.',
      eventId: event?._id ?? null,
    });
    if (event) await handOverSeat(event);
  }
}

/** The person accepts a held seat. */
export async function claimOffer(userId: Types.ObjectId | string, eventId: Types.ObjectId): Promise<boolean> {
  const claimed = await Registration.findOneAndUpdate(
    { event: eventId, user: userId, status: REGISTRATION_STATUS.OFFERED, offerExpiresAt: { $gt: new Date() } },
    { $set: { status: REGISTRATION_STATUS.GOING, offerExpiresAt: null } },
    { new: true }
  );
  return Boolean(claimed);
}

/** True while anyone is waiting, in which case a new RSVP must join the queue too. */
export const hasWaitlist = (eventId: Types.ObjectId) =>
  Registration.exists({ event: eventId, status: REGISTRATION_STATUS.WAITLISTED }).then(Boolean);

export type { RegistrationStatus };
