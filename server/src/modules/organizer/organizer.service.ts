import type { Types } from 'mongoose';
import { Event, Registration, OrganizerApplication, type UserDocument } from '../../models';
import { badRequest, conflict } from '../../lib/errors';
import { OWNER_FIELDS, withViewerContext } from '../events/events.policy';
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
  const events = await Event.find({ organizers: user._id, visibility: EVENT_VISIBILITY.PUBLIC })
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
