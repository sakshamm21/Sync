import type { FilterQuery, SortOrder, Types } from 'mongoose';
import { Event, Registration, Message, Note, EventStaff, Report, Rating, type EventDocument, type IEvent, type UserDocument } from '../../models';
import env from '../../config/env';
import { forbidden, badRequest } from '../../lib/errors';
import { paginationMeta, escapeRegex } from '../../lib/schemas';
import { buildEventCalendar } from '../../lib/ics';
import * as notifications from '../notifications/notifications.service';
import { fillFromWaitlist } from './waitlist.service';
import {
  OWNER_FIELDS,
  canPublishPublicEvents,
  findViewableEvent,
  loadEvent,
  withViewerContext,
  present,
  type Viewer,
} from './events.policy';
import type { CalendarRange, CreateEventInput, ListEventsQuery, UpdateEventInput } from './events.schemas';
import { EVENT_VISIBILITY, EVENT_STATUS, NOTIFICATION_TYPES, type Category, type NotificationType } from '../../constants';

const publicListing = (): FilterQuery<IEvent> => ({ visibility: EVENT_VISIBILITY.PUBLIC, status: EVENT_STATUS.PUBLISHED });

async function notifyAttendees(event: EventDocument, { type, title, body }: { type: NotificationType; title: string; body: string }) {
  const attendees = await Registration.find({ event: event._id }).distinct('user');
  await notifications.notify(attendees, { type, title, body, eventId: event._id }, { email: true });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listPublic(viewer: Viewer, { q, category, organizer, from, to, sort, includePast, page, limit }: ListEventsQuery) {
  const filter = publicListing();
  if (!includePast) filter.endsAt = { $gte: new Date() };
  if (category) filter.category = category;
  if (organizer) filter.owner = organizer;
  if (from || to) filter.startsAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: pattern }, { description: pattern }, { 'venue.name': pattern }, { tags: pattern }];
  }

  const orders: Record<ListEventsQuery['sort'], Record<string, SortOrder>> = {
    soonest: { startsAt: 1 },
    popular: { attendeeCount: -1, startsAt: 1 },
    newest: { createdAt: -1 },
  };

  const [events, total] = await Promise.all([
    Event.find(filter).sort(orders[sort]).skip((page - 1) * limit).limit(limit).populate('owner', OWNER_FIELDS),
    Event.countDocuments(filter),
  ]);
  return { items: await withViewerContext(events, viewer), meta: paginationMeta({ page, limit }, total) };
}

/** Upcoming public events matching the user's interests that they haven't joined yet. */
export async function recommendedFor(user: UserDocument, limit = 6) {
  const joined: (string | Types.ObjectId)[] = await Registration.find({ user: user.id }).distinct('event');
  const filter: FilterQuery<IEvent> = { ...publicListing(), startsAt: { $gte: new Date() }, owner: { $ne: user._id } };
  // Well-rated events outrank merely popular ones, so a club cannot hold the
  // top slot forever on attendance alone.
  const byQuality = { ratingSum: -1, ratingCount: -1, attendeeCount: -1, startsAt: 1 } as const;

  let events: EventDocument[] = [];
  if (user.interests?.length) {
    events = await Event.find({ ...filter, _id: { $nin: joined }, category: { $in: user.interests } })
      .sort(byQuality)
      .limit(limit)
      .populate('owner', OWNER_FIELDS);
  }
  // Top up with other popular events so new users without interests still get suggestions.
  if (events.length < limit) {
    const more = await Event.find({ ...filter, _id: { $nin: [...joined, ...events.map((e) => e._id)] } })
      .sort(byQuality)
      .limit(limit - events.length)
      .populate('owner', OWNER_FIELDS);
    events = events.concat(more);
  }
  return withViewerContext(events, user);
}

interface VenueListing {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  events: { id: string; title: string; category: Category; startsAt: Date; endsAt: Date }[];
}

/** Venues of upcoming public events that have map coordinates, with what's on at each. */
export async function venueDirectory(): Promise<VenueListing[]> {
  const events = await Event.find({
    ...publicListing(),
    endsAt: { $gte: new Date() },
    'venue.latitude': { $ne: null },
    'venue.longitude': { $ne: null },
  })
    .sort({ startsAt: 1 })
    .select('title category startsAt endsAt venue');

  const venues = new Map<string, VenueListing>();
  for (const event of events) {
    const { name, address, latitude, longitude } = event.venue;
    if (latitude == null || longitude == null) continue;
    const key = `${(name || '').toLowerCase()}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
    let venue = venues.get(key);
    if (!venue) {
      venue = { name: name || address || 'Unnamed venue', address: address || '', latitude, longitude, events: [] };
      venues.set(key, venue);
    }
    venue.events.push({ id: event.id, title: event.title, category: event.category, startsAt: event.startsAt, endsAt: event.endsAt });
  }
  return [...venues.values()].sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name));
}

export async function getForViewer(viewer: Viewer, id: string) {
  return present(await findViewableEvent(viewer, id), viewer);
}

/** Everything that belongs on the user's calendar in a date range. */
export async function calendarFor(user: UserDocument, { from, to }: CalendarRange) {
  const registeredIds = await Registration.find({ user: user.id }).distinct('event');
  const events = await Event.find({
    startsAt: { $lt: to },
    endsAt: { $gt: from },
    status: { $ne: EVENT_STATUS.DRAFT },
    $or: [
      // Events the user created or helps run, including their own private
      // plans. The `owner` clause also covers events created before shared
      // ownership existed, which have no `organizers` array.
      { organizers: user._id },
      { owner: user._id },
      { _id: { $in: registeredIds }, visibility: EVENT_VISIBILITY.PUBLIC },
    ],
  })
    .sort({ startsAt: 1 })
    .populate('owner', OWNER_FIELDS);

  return withViewerContext(events, user);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function create(user: UserDocument, input: CreateEventInput) {
  const visibility = input.visibility ?? (canPublishPublicEvents(user) ? EVENT_VISIBILITY.PUBLIC : EVENT_VISIBILITY.PRIVATE);
  if (visibility === EVENT_VISIBILITY.PUBLIC && !canPublishPublicEvents(user)) {
    throw forbidden('Only organisers can publish public events. Apply to become an organiser from your profile.', 'ORGANIZER_ONLY');
  }

  const isPublic = visibility === EVENT_VISIBILITY.PUBLIC;
  const event = await Event.create({
    ...input,
    visibility,
    // Personal events have no registration, so drafts and capacity don't apply.
    status: isPublic ? input.status ?? EVENT_STATUS.PUBLISHED : EVENT_STATUS.PUBLISHED,
    capacity: isPublic ? input.capacity ?? null : null,
    owner: user._id,
    // The creator is always in `organizers` so co-ownership needs no special case.
    organizers: [user._id],
  });
  await event.populate('owner', OWNER_FIELDS);
  return present(event, user);
}

const logisticsSnapshot = (event: EventDocument) =>
  JSON.stringify([event.startsAt, event.endsAt, event.venue, event.onlineUrl]);

export async function update(user: UserDocument, id: string, changes: UpdateEventInput) {
  const { event, access } = await loadEvent(user, id);
  if (!access.canManage) throw forbidden('Only the organiser can change this event');
  if (event.status === EVENT_STATUS.CANCELLED) throw badRequest('Cancelled events cannot be edited');

  if (changes.visibility && changes.visibility !== event.visibility) {
    if (changes.visibility === EVENT_VISIBILITY.PUBLIC && !canPublishPublicEvents(user)) {
      throw forbidden('Only organisers can publish public events.', 'ORGANIZER_ONLY');
    }
    if (await Registration.exists({ event: event._id })) {
      throw badRequest('This event already has registrations, so its visibility cannot change');
    }
  }

  const logisticsBefore = logisticsSnapshot(event);
  const wasPublished = event.status === EVENT_STATUS.PUBLISHED;
  const previousCapacity = event.capacity;

  event.set(changes);
  if (event.endsAt <= event.startsAt) throw badRequest('The event must end after it starts');
  await event.save();

  if (event.visibility === EVENT_VISIBILITY.PUBLIC && wasPublished && logisticsSnapshot(event) !== logisticsBefore) {
    await notifyAttendees(event, {
      type: NOTIFICATION_TYPES.EVENT_UPDATED,
      title: `Update: ${event.title}`,
      body: 'The time or location of an event you registered for has changed. Check the latest details.',
    });
  }

  const capacityGrew =
    previousCapacity !== null && (event.capacity === null || event.capacity > previousCapacity);
  if (capacityGrew) await fillFromWaitlist(event);

  return getForViewer(user, id);
}

export async function cancel(user: UserDocument, id: string, { reason }: { reason: string }) {
  const { event, access } = await loadEvent(user, id);
  if (!access.canManage) throw forbidden('Only the organiser can cancel this event');
  if (event.visibility !== EVENT_VISIBILITY.PUBLIC) {
    throw badRequest('Only public events can be cancelled. Delete personal events instead.');
  }
  if (event.status !== EVENT_STATUS.CANCELLED) {
    event.status = EVENT_STATUS.CANCELLED;
    await event.save();
    await notifyAttendees(event, {
      type: NOTIFICATION_TYPES.EVENT_CANCELLED,
      title: `Cancelled: ${event.title}`,
      body: reason || 'The organiser has cancelled this event.',
    });
  }
  return present(event, user);
}

export async function remove(user: UserDocument, id: string): Promise<void> {
  const { event, access } = await loadEvent(user, id);
  if (!access.canManage) throw forbidden('Only the organiser can delete this event');

  if (event.visibility === EVENT_VISIBILITY.PUBLIC && event.status === EVENT_STATUS.PUBLISHED && !event.isPast) {
    await notifyAttendees(event, {
      type: NOTIFICATION_TYPES.EVENT_CANCELLED,
      title: `Cancelled: ${event.title}`,
      body: 'The organiser has removed this event.',
    });
  }

  await Promise.all([
    Registration.deleteMany({ event: event._id }),
    Message.deleteMany({ event: event._id }),
    EventStaff.deleteMany({ event: event._id }),
    Report.deleteMany({ event: event._id }),
    Rating.deleteMany({ event: event._id }),
    Note.updateMany({ event: event._id }, { $set: { event: null } }),
  ]);
  await event.deleteOne();
}

export async function toCalendarFile(viewer: Viewer, id: string) {
  const event = await findViewableEvent(viewer, id);
  const location = [event.venue?.name, event.venue?.address].filter(Boolean).join(', ') || event.onlineUrl;
  const slug = event.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event';
  return {
    filename: `${slug}.ics`,
    content: buildEventCalendar({
      uid: `${event.id}@sync`,
      title: event.title,
      description: event.description,
      location,
      url: `${env.clientUrl}/events/${event.id}`,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      cancelled: event.status === EVENT_STATUS.CANCELLED,
    }),
  };
}
