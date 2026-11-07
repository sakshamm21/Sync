/**
 * Club committees (Roadmap "Next" #10). The club account adds people once,
 * and they get access to every event the club runs: core members as
 * co-organisers, volunteers as door staff. New events pick them up too.
 */
import type { Types } from 'mongoose';
import { ClubMember, Event, EventStaff, User, type ClubRole, type EventDocument, type UserDocument } from '../../models';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import * as notifications from '../notifications/notifications.service';
import { NOTIFICATION_TYPES, ROLES, STAFF_ROLES } from '../../constants';

const staffRoleFor = (role: ClubRole) => (role === 'core' ? STAFF_ROLES.MANAGER : STAFF_ROLES.CHECKIN);

function assertClub(user: UserDocument) {
  if (user.role !== ROLES.ORGANIZER && user.role !== ROLES.ADMIN)
    throw forbidden('Only club accounts have a committee', 'NOT_A_CLUB');
}

/** Events the club runs that haven't finished, which committee changes apply to. */
const liveEvents = (clubId: Types.ObjectId) => Event.find({ owner: clubId, endsAt: { $gte: new Date() } }).select('_id owner');

/** Puts one person on one event's team (or updates their role); never touches the owner's row. */
async function placeOnEvent(
  event: Pick<EventDocument, '_id' | 'owner'>,
  userId: Types.ObjectId,
  role: ClubRole,
  by: Types.ObjectId
) {
  await EventStaff.updateOne(
    { event: event._id, user: userId, role: { $ne: STAFF_ROLES.OWNER } },
    { $set: { role: staffRoleFor(role), invitedBy: by } },
    { upsert: true }
  ).catch((err) => {
    // The owner's own row matched the unique index: leave it as owner.
    if ((err as { code?: number }).code !== 11000) throw err;
  });
  await Event.updateOne({ _id: event._id }, { $addToSet: { organizers: { $each: [userId, event.owner] } } });
}

export async function list(club: UserDocument) {
  assertClub(club);
  const rows = await ClubMember.find({ club: club._id })
    .sort({ role: 1, createdAt: 1 })
    .populate<{ user: { id: string; name: string; email: string; avatarUrl: string } | null }>('user', 'name email avatarUrl');
  return rows.map((r) => ({
    id: r.id as string,
    role: r.role,
    user: r.user && { id: r.user.id, name: r.user.name, email: r.user.email, avatarUrl: r.user.avatarUrl },
  }));
}

export async function add(club: UserDocument, { email, role }: { email: string; role: ClubRole }) {
  assertClub(club);
  const person = await User.findOne({ email });
  if (!person) throw notFound('No Sync account uses that email');
  if (person._id.equals(club._id)) throw badRequest("That's the club account itself");
  try {
    await ClubMember.create({ club: club._id, user: person._id, role });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict(`${person.name} is already on the committee`, 'ALREADY_MEMBER');
    throw err;
  }
  for (const event of await liveEvents(club._id)) await placeOnEvent(event, person._id, role, club._id);
  await notifications.notify([person._id], {
    type: NOTIFICATION_TYPES.STAFF_INVITED,
    title: `You're on the ${club.organization || club.name} committee`,
    body: role === 'core' ? 'You can now help run all of their events.' : 'You can now check people in at their events.',
  });
  return list(club);
}

export async function setRole(club: UserDocument, memberId: string, role: ClubRole) {
  assertClub(club);
  const row = await ClubMember.findOneAndUpdate({ _id: memberId, club: club._id }, { $set: { role } }, { new: true });
  if (!row) throw notFound('Committee member not found');
  for (const event of await liveEvents(club._id)) await placeOnEvent(event, row.user, role, club._id);
  return list(club);
}

export async function remove(club: UserDocument, memberId: string) {
  assertClub(club);
  const row = await ClubMember.findOneAndDelete({ _id: memberId, club: club._id });
  if (!row) throw notFound('Committee member not found');
  const ids = (await liveEvents(club._id)).map((e) => e._id);
  await EventStaff.deleteMany({ event: { $in: ids }, user: row.user, role: { $ne: STAFF_ROLES.OWNER } });
  await Event.updateMany({ _id: { $in: ids } }, { $pull: { organizers: row.user } });
  return list(club);
}

/** Called when a club creates an event: its committee joins the event's team. */
export async function staffNewEvent(event: Pick<EventDocument, '_id' | 'owner'>) {
  const ownerId = (event.owner as unknown as { _id?: Types.ObjectId })?._id ?? event.owner;
  const members = await ClubMember.find({ club: ownerId });
  for (const m of members) await placeOnEvent({ _id: event._id, owner: ownerId }, m.user, m.role, ownerId);
}
