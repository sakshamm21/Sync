import { Event, EventStaff, User, type EventDocument, type UserDocument } from '../../models';
import { forbidden, badRequest, notFound } from '../../lib/errors';
import * as notifications from '../notifications/notifications.service';
import { loadEvent } from './events.policy';
import { ROLES, EVENT_VISIBILITY, STAFF_ROLES, NOTIFICATION_TYPES } from '../../constants';

const STAFF_FIELDS = 'name avatarUrl organization role';

/**
 * Co-organisers run the event day to day, but only the owner (or an admin
 * moderating) decides who else gets full rights: adding, removing or
 * re-roling a co-organiser. Door staff can be managed by any co-organiser.
 */
function assertMayChangeManagers(user: UserDocument, event: EventDocument) {
  const isAdmin = user.role === ROLES.ADMIN && event.visibility === EVENT_VISIBILITY.PUBLIC;
  if (!event.isOwnedBy(user.id) && !isAdmin) {
    throw forbidden('Only the event owner can add, remove or change co-organisers', 'OWNER_ONLY');
  }
}

/** The owner's id, whether or not `owner` has been populated. */
const ownerId = (event: EventDocument) => {
  const owner = event.owner as unknown as { _id?: unknown };
  return owner && typeof owner === 'object' && '_id' in owner ? owner._id : event.owner;
};

/**
 * Everyone who can help run an event, with their role on it.
 *
 * The creator is always listed first. Events created before shared ownership
 * existed have no `EventStaff` row for them, so one is written on first read
 * rather than showing the organiser an empty team for their own event.
 */
export async function listStaff(eventId: string) {
  const event = await Event.findById(eventId).select('owner');
  if (!event) return [];

  await EventStaff.updateOne(
    { event: eventId, user: event.owner },
    { $setOnInsert: { role: STAFF_ROLES.OWNER, invitedBy: null } },
    { upsert: true }
  );

  const rows = await EventStaff.find({ event: eventId })
    .sort({ createdAt: 1 })
    .populate('user', STAFF_FIELDS)
    .populate('invitedBy', 'name');

  return rows.map((row) => ({
    id: row.id as string,
    role: row.role,
    user: row.user
      ? {
          id: (row.user as unknown as { id: string }).id,
          name: (row.user as unknown as { name: string }).name,
          avatarUrl: (row.user as unknown as { avatarUrl: string }).avatarUrl,
          organization: (row.user as unknown as { organization: string }).organization,
        }
      : null,
    invitedBy: row.invitedBy ? (row.invitedBy as unknown as { name: string }).name : null,
    createdAt: row.createdAt,
  }));
}

/** Adds someone to an event's team and tells them. */
export async function invite(user: UserDocument, eventId: string, { email, role }: { email: string; role: 'manager' | 'checkin' }) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can add people to the team');
  if (role === STAFF_ROLES.MANAGER) assertMayChangeManagers(user, event);

  const invitee = await User.findOne({ email });
  if (!invitee) throw notFound('No Sync account uses that email');
  if (event.isOwnedBy(invitee._id)) throw badRequest('They already own this event');

  const existing = await EventStaff.findOne({ event: event._id, user: invitee._id });
  if (existing) throw badRequest(`${invitee.name} is already on the team`, 'ALREADY_ON_TEAM');

  await EventStaff.create({ event: event._id, user: invitee._id, role, invitedBy: user._id });

  // `organizers` is the fast path used on every event read. `$addToSet` would
  // leave an event that predates shared ownership without its owner in the
  // array, so the owner is added in the same update.
  await Event.updateOne({ _id: event._id }, { $addToSet: { organizers: { $each: [invitee._id, ownerId(event)] } } });

  await notifications.notify(
    [invitee._id],
    {
      type: NOTIFICATION_TYPES.STAFF_INVITED,
      title: `You're helping run: ${event.title}`,
      body: `${user.name} added you as ${role === 'checkin' ? 'check-in staff' : 'a co-organiser'}.`,
      eventId: event._id,
    },
    { email: true }
  );

  return listStaff(eventId);
}

/**
 * The team row someone asked to change, refusing the owner's. The owner is
 * recognised by who they are, not by their row's role, so no edit to the row
 * can make the owner removable.
 */
async function findChangeableRow(event: EventDocument, staffId: string) {
  const row = await EventStaff.findById(staffId);
  if (!row || String(row.event) !== String(event._id)) throw notFound('That person is not on the team');
  if (event.isOwnedBy(row.user)) {
    throw badRequest("The event owner's place on the team cannot be changed", 'OWNER_PROTECTED');
  }
  return row;
}

/** Removes someone from the team. The owner can never be removed. */
export async function removeStaff(user: UserDocument, eventId: string, staffId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can change the team');

  const row = await findChangeableRow(event, staffId);
  if (row.role !== STAFF_ROLES.CHECKIN) assertMayChangeManagers(user, event);

  await EventStaff.deleteOne({ _id: row._id });
  await Event.updateOne({ _id: event._id }, { $pull: { organizers: row.user } });

  return listStaff(eventId);
}

/** Changes someone's role on the team. The owner's role never changes. */
export async function setStaffRole(user: UserDocument, eventId: string, staffId: string, role: 'manager' | 'checkin') {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can change the team');

  const row = await findChangeableRow(event, staffId);
  if (row.role !== STAFF_ROLES.CHECKIN || role !== STAFF_ROLES.CHECKIN) assertMayChangeManagers(user, event);
  await EventStaff.updateOne({ _id: row._id }, { $set: { role } });
  return listStaff(eventId);
}