import type { Types } from 'mongoose';
import { Event, Rating, Registration, OrganizerApplication, type UserDocument } from '../../models';
import env from '../../config/env';
import { badRequest, conflict, forbidden } from '../../lib/errors';
import { OWNER_FIELDS, loadEvent, withViewerContext } from '../events/events.policy';
import { ROLES, EVENT_VISIBILITY, EVENT_STATUS, REGISTRATION_STATUS, ORGANIZER_APPLICATION_STATUS } from '../../constants';

interface EventCounts {
  _id: Types.ObjectId;
  going: number;
  waitlisted: number;
  checkedIn: number;
}

export async function apply(user: UserDocument, { organization, reason }: { organization: string; reason: string }) {
  if (user.role !== ROLES.MEMBER) throw badRequest('You can already publish events', 'ALREADY_ORGANIZER');
  if (await OrganizerApplication.exists({ user: user._id, status: ORGANIZER_APPLICATION_STATUS.PENDING })) {
    throw conflict('Your application is already being reviewed', 'APPLICATION_PENDING');
  }
  return OrganizerApplication.create({ user: user._id, organization, reason });
}

export function latestApplication(user: UserDocument) {
  return OrganizerApplication.findOne({ user: user._id }).sort({ createdAt: -1 });
}

/** Headline numbers and per-event registration counts for the organiser dashboard. */
export async function overview(user: UserDocument) {
  // Events the user created *or* was invited to help run.
  //
  // `$or` with the `owner` clause also matches events created before shared
  // ownership existed, which have no `organizers` array; `isCoOrganizer`
  // treats their creator as the organiser.
  const events = await Event.find({ visibility: EVENT_VISIBILITY.PUBLIC, $or: [{ organizers: user._id }, { owner: user._id }] })
    .sort({ startsAt: -1 })
    .populate('owner', OWNER_FIELDS);

  const counts = await Registration.aggregate<EventCounts>([
    { $match: { event: { $in: events.map((e) => e._id) } } },
    {
      $group: {
        _id: '$event',
        going: { $sum: { $cond: [{ $eq: ['$status', REGISTRATION_STATUS.GOING] }, 1, 0] } },
        waitlisted: { $sum: { $cond: [{ $eq: ['$status', REGISTRATION_STATUS.WAITLISTED] }, 1, 0] } },
        checkedIn: { $sum: { $cond: [{ $ne: ['$checkedInAt', null] }, 1, 0] } },
      },
    },
  ]);
  const countsByEvent = new Map(counts.map((c) => [String(c._id), c]));

  const items = (await withViewerContext(events, user)).map((event) => {
    const c = countsByEvent.get(event.id) ?? { going: 0, waitlisted: 0, checkedIn: 0 };
    return { ...event, stats: { going: c.going, waitlisted: c.waitlisted, checkedIn: c.checkedIn } };
  });

  const now = new Date();
  const live = items.filter((e) => e.status !== EVENT_STATUS.CANCELLED);
  const past = live.filter((e) => new Date(e.endsAt) < now);
  const pastGoing = past.reduce((sum, e) => sum + e.stats.going, 0);
  const pastCheckedIn = past.reduce((sum, e) => sum + e.stats.checkedIn, 0);

  return {
    stats: {
      totalEvents: live.length,
      upcomingEvents: live.filter((e) => new Date(e.endsAt) >= now && e.status === EVENT_STATUS.PUBLISHED).length,
      drafts: live.filter((e) => e.status === EVENT_STATUS.DRAFT).length,
      totalRegistrations: live.reduce((sum, e) => sum + e.stats.going, 0),
      waitlisted: live.reduce((sum, e) => sum + e.stats.waitlisted, 0),
      // Share of registered attendees at finished events who actually showed up.
      attendanceRate: pastGoing ? Math.round((pastCheckedIn / pastGoing) * 100) : null,
    },
    events: items,
  };
}

/**
 * Numbers for one event (Roadmap "Next" #4): RSVPs per day on the campus
 * calendar, where people are now, how many turned up, and how it was rated.
 */
export async function insights(user: UserDocument, eventId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can see insights');
  const [byDay, byStatus, checkedIn, ratings] = await Promise.all([
    Registration.aggregate<{ _id: string; count: number }>([
      { $match: { event: event._id } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: env.campusTimeZone } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Registration.aggregate<{ _id: string; count: number }>([
      { $match: { event: event._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Registration.countDocuments({ event: event._id, checkedInAt: { $ne: null } }),
    Rating.aggregate<{ _id: number; count: number }>([
      { $match: { event: event._id } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);
  const statuses = Object.fromEntries(byStatus.map((s) => [s._id, s.count])) as Record<string, number>;
  const going = statuses.going ?? 0;
  const ratingCount = ratings.reduce((n, r) => n + r.count, 0);
  const ratingSum = ratings.reduce((n, r) => n + r._id * r.count, 0);
  return {
    rsvpsByDay: byDay.map((d) => ({ day: d._id, count: d.count })),
    going,
    waitlisted: statuses.waitlisted ?? 0,
    pending: statuses.pending ?? 0,
    interested: event.interestedCount ?? 0,
    checkedIn,
    // Only meaningful once the event has happened.
    showUpRate: event.endsAt < new Date() && going ? Math.round((checkedIn / going) * 100) : null,
    averageRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    ratingCount,
  };
}
