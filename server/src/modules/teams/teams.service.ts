/**
 * Teams at team events (Roadmap "Next" #2). Everyone still RSVPs as a
 * person (seats and waitlists are per person); a team groups registered
 * people. One person creates it and shares its code; others join with it.
 */
import crypto from 'node:crypto';
import { Registration, Team, type TeamDocument, type UserDocument } from '../../models';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { loadEvent } from '../events/events.policy';
import { REGISTRATION_STATUS } from '../../constants';

/** No 0/O or 1/I, so a code read out loud can't be misheard. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

async function teamEventFor(user: UserDocument, eventId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!event.teamSize) throw badRequest('This event is not a team event', 'NOT_A_TEAM_EVENT');
  return { event, access };
}

async function assertRegistered(user: UserDocument, eventId: unknown) {
  const reg = await Registration.findOne({ event: eventId, user: user._id });
  if (!reg || ![REGISTRATION_STATUS.GOING, REGISTRATION_STATUS.WAITLISTED].includes(reg.status as never)) {
    throw badRequest('RSVP to the event first, then create or join a team', 'NOT_REGISTERED');
  }
}

async function present(team: TeamDocument | null, viewerId?: string) {
  if (!team) return null;
  await team.populate<{ members: { id: string; name: string; avatarUrl: string }[] }>('members', 'name avatarUrl');
  const regs = await Registration.find({ event: team.event, user: { $in: team.members } }).select('user status checkedInAt');
  const byUser = new Map(regs.map((r) => [String(r.user), r]));
  const members = team.members as unknown as { id: string; name: string; avatarUrl: string }[];
  const isMember = Boolean(viewerId && members.some((m) => m.id === viewerId));
  return {
    id: team.id as string,
    name: team.name,
    // Only teammates (and organisers) need the join code.
    code: isMember ? team.code : undefined,
    captain: String(team.captain),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      avatarUrl: m.avatarUrl,
      status: byUser.get(m.id)?.status ?? null,
      checkedIn: Boolean(byUser.get(m.id)?.checkedInAt),
    })),
  };
}

export async function mine(user: UserDocument, eventId: string) {
  const { event } = await teamEventFor(user, eventId);
  return present(await Team.findOne({ event: event._id, members: user._id }), user.id);
}

export async function create(user: UserDocument, eventId: string, name: string) {
  const { event } = await teamEventFor(user, eventId);
  await assertRegistered(user, event._id);
  if (await Team.exists({ event: event._id, members: user._id }))
    throw conflict('You are already in a team for this event', 'ALREADY_IN_TEAM');
  try {
    const team = await Team.create({ event: event._id, name, code: newCode(), captain: user._id, members: [user._id] });
    return present(team, user.id);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('That team name is taken for this event', 'TEAM_NAME_TAKEN');
    throw err;
  }
}

export async function join(user: UserDocument, eventId: string, code: string) {
  const { event } = await teamEventFor(user, eventId);
  await assertRegistered(user, event._id);
  if (await Team.exists({ event: event._id, members: user._id }))
    throw conflict('You are already in a team for this event', 'ALREADY_IN_TEAM');
  const max = event.teamSize!.max;
  // Conditional on there being room, so two people can't both take the last place.
  const team = await Team.findOneAndUpdate(
    { event: event._id, code: code.trim().toUpperCase(), [`members.${max - 1}`]: { $exists: false } },
    { $addToSet: { members: user._id } },
    { new: true }
  );
  if (!team) {
    if (await Team.exists({ event: event._id, code: code.trim().toUpperCase() }))
      throw badRequest(`That team is full (${max} max)`, 'TEAM_FULL');
    throw notFound('No team with that code for this event', 'BAD_TEAM_CODE');
  }
  return present(team, user.id);
}

/** Leave your team; the last one out deletes it, and the captaincy passes on if the captain leaves. */
export async function leave(user: UserDocument, eventId: string) {
  const { event } = await teamEventFor(user, eventId);
  const team = await Team.findOne({ event: event._id, members: user._id });
  if (!team) throw notFound('You are not in a team for this event');
  team.members = team.members.filter((m) => !m.equals(user._id));
  if (!team.members.length) await team.deleteOne();
  else {
    if (team.captain.equals(user._id)) team.captain = team.members[0];
    await team.save();
  }
  return null;
}

/** All teams, for the organiser and door staff, with how complete each is. */
export async function list(user: UserDocument, eventId: string) {
  const { event, access } = await teamEventFor(user, eventId);
  if (!access.canCheckIn) throw forbidden('Only the event team can see all teams');
  const teams = await Team.find({ event: event._id }).sort({ name: 1 });
  const out: (NonNullable<Awaited<ReturnType<typeof present>>> & { complete: boolean })[] = [];
  for (const t of teams) {
    const p = await present(t);
    out.push({ ...p!, code: access.canManage ? t.code : undefined, complete: t.members.length >= event.teamSize!.min });
  }
  return { teamSize: event.teamSize, teams: out };
}

/** Checks in every confirmed member of a team at once. */
export async function checkInTeam(user: UserDocument, eventId: string, teamId: string) {
  const { event, access } = await teamEventFor(user, eventId);
  if (!access.canCheckIn) throw forbidden('You cannot check people in for this event');
  const team = await Team.findOne({ _id: teamId, event: event._id });
  if (!team) throw notFound('Team not found');
  const result = await Registration.updateMany(
    { event: event._id, user: { $in: team.members }, status: REGISTRATION_STATUS.GOING, checkedInAt: null },
    { $set: { checkedInAt: new Date() } }
  );
  return { checkedIn: result.modifiedCount };
}
