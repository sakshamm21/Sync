/**
 * Post-event ratings. Only someone who actually attended can score an event,
 * and `Event.ratingSum` / `ratingCount` are kept in step so recommendations
 * can sort by quality without aggregating on every read.
 */
import { Event, Rating, Registration, type UserDocument } from '../../models';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { Types } from 'mongoose';
import { loadEvent } from './events.policy';
import { EVENT_VISIBILITY, EVENT_STATUS, REGISTRATION_STATUS, MAX_RATING } from '../../constants';

export interface EventRating {
  average: number | null;
  count: number;
  /** The viewer's own score, if they have left one. */
  mine: number | null;
  myComment: string;
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
    Rating.findOne({ event: event._id, user: user.id }).select('rating comment'),
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
    myComment: mine?.comment ?? '',
    breakdown,
  };
}

/** Records or updates the viewer's score. Only people checked in at the door may rate. */
export async function rate(user: UserDocument, eventId: string, value: number, comment?: string) {
  const { event } = await loadEvent(user, eventId);
  if (event.visibility !== EVENT_VISIBILITY.PUBLIC) throw badRequest('Only public events can be rated');
  if (event.status === EVENT_STATUS.CANCELLED) throw badRequest('This event was cancelled');

  const registration = await Registration.findOne({ event: event._id, user: user.id });
  if (!registration || registration.status !== REGISTRATION_STATUS.GOING || !registration.checkedInAt) {
    throw forbidden('Only people checked in at the event can rate it', 'NOT_ATTENDED');
  }
  // A score is feedback on something that happened, so the event must be over.
  if (!event.isPast) throw badRequest('You can rate this once it has finished');

  await Rating.findOneAndUpdate(
    { event: event._id, user: user.id },
    { $set: { rating: value, ...(comment !== undefined ? { comment } : {}) } },
    { upsert: true, new: true }
  );
  await syncTotals(String(event._id));

  return summaryFor(user, eventId);
}

/** Written feedback for the organisers: comments only, no names (people write more honestly). */
export async function feedbackFor(user: UserDocument, eventId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can read feedback');
  const rows = await Rating.find({ event: event._id, comment: { $ne: '' } })
    .sort({ updatedAt: -1 })
    .limit(200);
  return rows.map((r) => ({ rating: r.rating, comment: r.comment, at: r.updatedAt }));
}

/**
 * A participation certificate for someone checked in at a finished event
 * (Roadmap "Next" #5). Returns what the printable page needs, or 404.
 */
export async function certificate(user: UserDocument, eventId: string) {
  const { event } = await loadEvent(user, eventId);
  const registration = await Registration.findOne({ event: event._id, user: user._id, checkedInAt: { $ne: null } });
  if (!registration || !event.isPast || event.status === EVENT_STATUS.CANCELLED) {
    throw notFound('Certificates are for people checked in at an event that has finished', 'NO_CERTIFICATE');
  }
  await event.populate<{ owner: { name: string; organization: string } }>('owner', 'name organization');
  const owner = event.owner as unknown as { name?: string; organization?: string } | null;
  return {
    name: user.name,
    event: {
      id: event.id as string,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venue: event.venue?.name ?? '',
    },
    host: owner?.organization || owner?.name || 'Sync',
    checkedInAt: registration.checkedInAt,
    // Short, checkable reference printed on the certificate.
    reference: `SYNC-${String(registration._id).slice(-8).toUpperCase()}`,
  };
}
