/**
 * Post-event ratings. Only someone who actually attended can score an event,
 * and `Event.ratingSum` / `ratingCount` are kept in step so recommendations
 * can sort by quality without aggregating on every read.
 */
import { Event, Rating, Registration, type UserDocument } from '../../models';
import { badRequest, forbidden } from '../../lib/errors';
import { Types } from 'mongoose';
import { loadEvent } from './events.policy';
import { EVENT_VISIBILITY, EVENT_STATUS, REGISTRATION_STATUS, MAX_RATING } from '../../constants';

export interface EventRating {
  average: number | null;
  count: number;
  /** The viewer's own score, if they have left one. */
  mine: number | null;
  /** Star-by-star breakdown, index 0 = one star. */
  breakdown: number[];
}

/** Recomputes the cached totals for one event from the ratings that exist. */
export async function syncTotals(eventId: string) {
  // `aggregate` does not cast ids the way `find` does, so the ObjectId is
  // built explicitly; a plain string would match nothing.
  const [stats] = await Rating.aggregate([
    { $match: { event: new Types.ObjectId(eventId) } },
    { $group: { _id: '$event', sum: { $sum: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Event.updateOne({ _id: eventId }, { $set: { ratingSum: stats?.sum ?? 0, ratingCount: stats?.count ?? 0 } });
}

/** The average, the total, the viewer's own score and the star breakdown. */
export async function summaryFor(user: UserDocument, eventId: string): Promise<EventRating> {
  const { event } = await loadEvent(user, eventId);
  const [rows, mine] = await Promise.all([
    Rating.aggregate([
      { $match: { event: new Types.ObjectId(String(event._id)) } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
    Rating.findOne({ event: event._id, user: user.id }).select('rating'),
  ]);

  // Average and count both come from this one aggregation, so they always agree.
  const breakdown = Array.from({ length: MAX_RATING }, () => 0);
  let count = 0;
  let sum = 0;
  for (const row of rows) {
    const stars = Number(row._id);
    if (stars >= 1 && stars <= MAX_RATING) {
      breakdown[stars - 1] = row.count as number;
      count += row.count as number;
      sum += stars * (row.count as number);
    }
  }

  return {
    average: count ? Math.round((sum / count) * 10) / 10 : null,
    count,
    mine: mine?.rating ?? null,
    breakdown,
  };
}

/** Records or updates the viewer's score. Only people checked in at the door may rate. */
export async function rate(user: UserDocument, eventId: string, value: number) {
  const { event } = await loadEvent(user, eventId);
  if (event.visibility !== EVENT_VISIBILITY.PUBLIC) throw badRequest('Only public events can be rated');
  if (event.status === EVENT_STATUS.CANCELLED) throw badRequest('This event was cancelled');

  const registration = await Registration.findOne({ event: event._id, user: user.id });
  if (!registration || registration.status !== REGISTRATION_STATUS.GOING || !registration.checkedInAt) {
    throw forbidden('Only people checked in at the event can rate it', 'NOT_ATTENDED');
  }
  // A score is feedback on something that happened, so the event must be over.
  if (!event.isPast) throw badRequest('You can rate this once it has finished');

  await Rating.findOneAndUpdate({ event: event._id, user: user.id }, { $set: { rating: value } }, { upsert: true, new: true });
  await syncTotals(String(event._id));

  return summaryFor(user, eventId);
}
