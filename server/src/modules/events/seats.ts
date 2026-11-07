/**
 * Seat accounting for a capped event.
 *
 * Kept in its own module because both the registration flow and the waitlist
 * need it, and they must not import each other.
 */
import type { Types } from 'mongoose';
import { Event } from '../../models';

/**
 * Atomically takes a seat if one is free. Two people can never get the last
 * seat because the capacity check and the increment are a single update.
 *
 * `attendeeCount` is a cache of the confirmed registrations; if a process dies
 * between this call and the `Registration` write, the counter would drift, so
 * `jobs/maintenance.ts` reconciles it back to the truth.
 */
export async function claimSeat(eventId: Types.ObjectId): Promise<boolean> {
  const claimed = await Event.updateOne(
    { _id: eventId, $or: [{ capacity: null }, { $expr: { $lt: ['$attendeeCount', '$capacity'] } }] },
    { $inc: { attendeeCount: 1 } }
  );
  return claimed.modifiedCount === 1;
}

/** Gives a seat back. Guarded so the count can never go below zero. */
export const releaseSeat = (eventId: Types.ObjectId) =>
  Event.updateOne({ _id: eventId, attendeeCount: { $gt: 0 } }, { $inc: { attendeeCount: -1 } });
