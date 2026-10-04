import { Event, EventStaff, User, type UserDocument } from '../../models';
import { forbidden, badRequest, notFound } from '../../lib/errors';
import * as notifications from '../notifications/notifications.service';
import { loadEvent } from './events.policy';
import { STAFF_ROLES, NOTIFICATION_TYPES } from '../../constants';

const STAFF_FIELDS = 'name avatarUrl organization role';

/** Everyone who can help run an event, with their role on it. */
export async function listStaff(eventId: string) {
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

  const invitee = await User.findOne({ email });
  if (!invitee) throw notFound('No Syncronify account uses that email');
  if (String(invitee._id) === String(event.owner)) throw badRequest('They already own this event');

  const existing = await EventStaff.findOne({ event: event._id, user: invitee._id });
  if (existing) throw badRequest(`${invitee.name} is already on the team`, 'ALREADY_ON_TEAM');

  await EventStaff.create({ event: event._id, user: invitee._id, role, invitedBy: user._id });

  // `organizers` is the fast path used on every event read; keep it in step.
  await Event.updateOne({ _id: event._id }, { $addToSet: { organizers: invitee._id } });

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

/** Removes someone from the team. The owner can never be removed. */
export async function removeStaff(user: UserDocument, eventId: string, staffId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can change the team');

  const row = await EventStaff.findById(staffId);
  if (!row || String(row.event) !== String(event._id)) throw notFound('That person is not on the team');
  if (row.role === STAFF_ROLES.OWNER) throw badRequest('The event owner cannot be removed');

  await EventStaff.deleteOne({ _id: row._id });
  await Event.updateOne({ _id: event._id }, { $pull: { organizers: row.user } });

  return listStaff(eventId);
}

/** Changes someone's role on the team. */
export async function setStaffRole(user: UserDocument, eventId: string, staffId: string, role: 'owner' | 'manager' | 'checkin') {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can change the team');

  const row = await EventStaff.findById(staffId);
  if (!row || String(row.event) !== String(event._id)) throw notFound('That person is not on the team');

  await EventStaff.updateOne({ _id: row._id }, { $set: { role } });
    return listStaff(eventId);
  }