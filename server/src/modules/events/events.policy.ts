/**
 * Who can see and do what with an event, and the per-viewer view of it.
 * Shared by the events, registrations, chat, staff and notes services.
 */
import { Event, Registration, EventStaff, Interest, type EventDocument, type IEvent, type UserDocument } from '../../models';
import { forbidden, notFound } from '../../lib/errors';
import { ROLES, EVENT_VISIBILITY, EVENT_STATUS, STAFF_ROLES, type RegistrationStatus, type StaffRole } from '../../constants';

export const OWNER_FIELDS = 'name avatarUrl organization role';

/** The signed-in user, or undefined for anonymous visitors. */
export type Viewer = UserDocument | undefined;

export const canPublishPublicEvents = (user: UserDocument) => user.role === ROLES.ORGANIZER || user.role === ROLES.ADMIN;

/** The staff role a viewer holds on this event, or null if they hold none. */
export type StaffRoleOfViewer = StaffRole | null;

export interface ViewerAccess {
  /** True for the creator and for anyone else invited to help run it. */
  isOrganizer: boolean;
  /** Can edit the event, manage staff, check people in, cancel it. */
  canManage: boolean;
  /** Can check people in at the door, but not change the event. */
  canCheckIn: boolean;
}

const NO_ACCESS: ViewerAccess = { isOrganizer: false, canManage: false, canCheckIn: false };
const FULL_ACCESS: ViewerAccess = { isOrganizer: true, canManage: true, canCheckIn: true };
const DOOR_ACCESS: ViewerAccess = { isOrganizer: true, canManage: false, canCheckIn: true };

/**
 * What a viewer may do with an event. Admins moderate public events but never
 * see anyone's private calendar; `checkin` staff work the door only.
 *
 * `staffRole` is the viewer's row in EventStaff (see `staffRoleFor`). It is
 * required on purpose: a co-organiser whose role isn't known gets door rights
 * only, never full rights, so forgetting to look the role up fails safe.
 */
export function accessFor(user: Viewer, event: EventDocument, staffRole: StaffRoleOfViewer): ViewerAccess {
  if (!user) return NO_ACCESS;
  if (user.role === ROLES.ADMIN && event.visibility === EVENT_VISIBILITY.PUBLIC) return FULL_ACCESS;
  // The creator can always manage, whatever their EventStaff row says.
  if (event.isOwnedBy(user.id)) return FULL_ACCESS;
  if (!event.isCoOrganizer(user.id)) return NO_ACCESS;
  return staffRole === STAFF_ROLES.MANAGER || staffRole === STAFF_ROLES.OWNER ? FULL_ACCESS : DOOR_ACCESS;
}

/** True for the creator and anyone on the event's team, whatever their role. */
const isOnTeam = (user: Viewer, event: EventDocument) => Boolean(user) && event.isCoOrganizer(user?.id);

function canView(user: Viewer, event: EventDocument): boolean {
  if (event.visibility === EVENT_VISIBILITY.PRIVATE) return isOnTeam(user, event);
  // A draft is shown to its team and to admins, who moderate public events.
  if (event.status === EVENT_STATUS.DRAFT) return isOnTeam(user, event) || user?.role === ROLES.ADMIN;
  return true;
}

/** Loads an event the viewer is allowed to see. Hidden events look exactly like missing ones. */
export async function findViewableEvent(viewer: Viewer, id: string): Promise<EventDocument> {
  const event = await Event.findById(id).populate('owner', OWNER_FIELDS);
  if (!event || !canView(viewer, event)) throw notFound('Event not found');
  return event;
}

/** The viewer's staff role on an event, or null. */
export async function staffRoleFor(viewer: Viewer, event: EventDocument): Promise<StaffRoleOfViewer> {
  if (!viewer) return null;
  if (event.isOwnedBy(viewer.id)) return STAFF_ROLES.OWNER;
  const row = await EventStaff.findOne({ event: event._id, user: viewer.id }).select('role');
  return row?.role ?? null;
}

export interface LoadedEvent {
  event: EventDocument;
  staffRole: StaffRoleOfViewer;
  access: ViewerAccess;
}

/** `findViewableEvent` plus the viewer's role and what it allows. */
export async function loadEvent(viewer: Viewer, id: string): Promise<LoadedEvent> {
  const event = await findViewableEvent(viewer, id);
  const staffRole = await staffRoleFor(viewer, event);
  return { event, staffRole, access: accessFor(viewer, event, staffRole) };
}

/** The event plus its staff role, for routes that require management rights. */
export async function findManageableEvent(user: UserDocument, id: string): Promise<LoadedEvent> {
  const loaded = await loadEvent(user, id);
  if (!loaded.access.canManage) throw forbidden('Only the organiser can change this event');
  return loaded;
}

/** The event plus its staff role, for routes that need door rights. */
export async function findCheckinEvent(user: UserDocument, id: string): Promise<LoadedEvent> {
  const loaded = await loadEvent(user, id);
  if (!loaded.access.canCheckIn) throw forbidden('You cannot check people in for this event');
  return loaded;
}

/** Chat is for public events, between the event's team, its attendees and admins. */
export function canChat(user: Viewer, event: EventDocument, registrationStatus: RegistrationStatus | null | undefined): boolean {
  if (!user || event.visibility !== EVENT_VISIBILITY.PUBLIC || event.status === EVENT_STATUS.DRAFT) return false;
  return user.role === ROLES.ADMIN || isOnTeam(user, event) || Boolean(registrationStatus);
}

/** An event as the API returns it: the stored fields plus the viewer's relationship to it. */
export type PresentedEvent = Omit<IEvent, 'owner' | 'organizers'> & {
  id: string;
  /** A user summary when populated, otherwise the owner's id. */
  owner: unknown;
  spotsLeft: number | null;
  isPast: boolean;
  averageRating: number | null;
  viewer: {
    /** True for the creator; false for a co-organiser or an admin moderating. */
    isOwner: boolean;
    isOrganizer: boolean;
    canManage: boolean;
    canCheckIn: boolean;
    canChat: boolean;
    /** The viewer's staff role on this event, when they hold one. */
    staffRole: StaffRole | null;
    registration: RegistrationStatus | null;
    /** 1 = next in line; only on a single event the viewer is waitlisted for. */
    waitlistPosition?: number;
    /** Bookmarked as "Interested". */
    interested: boolean;
    /** For a held seat: claim it before this. */
    offerExpiresAt?: Date | null;
  };
};

/**
 * Adds a `viewer` block describing the current user's relationship to each
 * event. Staff roles for every listed event are fetched in one query, so a
 * list of 20 events costs two extra round trips, not twenty.
 */
export async function withViewerContext(events: EventDocument[], viewer: Viewer): Promise<PresentedEvent[]> {
  if (!events.length) return [];

  const registrations = viewer
    ? await Registration.find({ user: viewer.id, event: { $in: events.map((e) => e._id) } }).select('event status')
    : [];
  const statusByEvent = new Map(registrations.map((r) => [String(r.event), r.status]));

  const staff = viewer
    ? await EventStaff.find({ user: viewer.id, event: { $in: events.map((e) => e._id) } }).select('event role')
    : [];
  const roleByEvent = new Map(staff.map((s) => [String(s.event), s.role]));

  const interests = viewer
    ? await Interest.find({ user: viewer.id, event: { $in: events.map((e) => e._id) } }).select('event')
    : [];
  const interestedIn = new Set(interests.map((i) => String(i.event)));

  return events.map((event) => {
    const registration = statusByEvent.get(String(event._id)) ?? null;
    const isOwner = viewer ? event.isOwnedBy(viewer.id) : false;
    const staffRole = roleByEvent.get(String(event._id)) ?? (isOwner ? STAFF_ROLES.OWNER : null);
    const access = accessFor(viewer, event, staffRole);
    return {
      // toJSON adds `id` and the virtuals (see config/db.ts), which Mongoose's types don't model.
      ...(event.toJSON() as unknown as Omit<PresentedEvent, 'viewer'>),
      viewer: {
        isOwner,
        isOrganizer: access.isOrganizer,
        canManage: access.canManage,
        canCheckIn: access.canCheckIn,
        canChat: canChat(viewer, event, registration),
        staffRole,
        registration,
        interested: interestedIn.has(String(event._id)),
      },
    };
  });
}

export async function present(event: EventDocument, viewer: Viewer): Promise<PresentedEvent> {
  const [json] = await withViewerContext([event], viewer);
  return json;
}
