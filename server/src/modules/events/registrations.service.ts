import type { FilterQuery } from 'mongoose';
import { Event, Registration, type IEvent, type UserDocument } from '../../models';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { handOverSeat, hasWaitlist, clashesWith, type Clash } from './waitlist.service';
import { claimSeat, releaseSeat } from './seats';
import { loadEvent, withViewerContext, present, OWNER_FIELDS, type PresentedEvent } from './events.policy';
import { EVENT_STATUS, REGISTRATION_STATUS, type RegistrationStatus } from '../../constants';

type AttendeeUser = Pick<UserDocument, 'id' | 'name' | 'email' | 'avatarUrl'>;

/**
 * The presented event plus any clash with the user's own plans. The event
 * stays at the top level so existing callers keep working unchanged.
 */
export interface RegistrationResult {
  event: PresentedEvent;
  status: RegistrationStatus;
  /** Confirmed events already on the user's calendar that overlap this one. */
  clashes: Clash[];
}

/** The API shape for RSVP: the event itself, with `clashes` hung off it. */
export type RegistrationResponse = PresentedEvent & { clashes: Clash[] };

export async function register(user: UserDocument, eventId: string): Promise<RegistrationResponse> {
  const { event } = await loadEvent(user, eventId);
  if (!event.isOpenForRegistration()) throw badRequest('Registration is closed for this event', 'REGISTRATION_CLOSED');
  if (event.isCoOrganizer(user.id)) throw badRequest('You are organising this event', 'OWN_EVENT');

  // Checked before claiming so the user sees the clash without a seat waitlisting first.
  const clashes = await clashesWith(user, event);

  const existing = await Registration.findOne({ event: event._id, user: user.id });
  if (!existing) {
    // Nobody jumps the queue: while people are waiting, a new RSVP waits too,
    // even if a seat looks free for a moment.
    const gotSeat = !(await hasWaitlist(event._id)) && (await claimSeat(event._id));
    try {
      await Registration.create({
        event: event._id,
        user: user._id,
        status: gotSeat ? REGISTRATION_STATUS.GOING : REGISTRATION_STATUS.WAITLISTED,
      });
    } catch (err) {
      // A concurrent request registered the same user first; give the seat back.
      if (gotSeat) await releaseSeat(event._id);
      if ((err as { code?: unknown })?.code !== 11000) throw err;
    }
  }

  // Re-read the event so the caller sees the seat count after their own change.
  const fresh = await loadEvent(user, eventId);
  return { ...(await present(fresh.event, user)), clashes };
}

export async function unregister(user: UserDocument, eventId: string) {
  const { event } = await loadEvent(user, eventId);
  // Once an event has started, registrations are its attendance record (check-ins,
  // the organiser's attendance rate, who may rate it), so they stay.
  if (event.startsAt <= new Date() && event.status !== EVENT_STATUS.CANCELLED) {
    throw badRequest('This event has already started, so you can no longer leave it', 'EVENT_STARTED');
  }
  const registration = await Registration.findOneAndDelete({ event: event._id, user: user.id });
  if (!registration) throw notFound('You are not registered for this event', 'NOT_REGISTERED');

  if (registration.status === REGISTRATION_STATUS.GOING) {
    await handOverSeat(event);
  }
  const fresh = await loadEvent(user, eventId);
  return present(fresh.event, user);
}

/**
 * The attendee list. Requires management rights rather than door rights: it
 * contains everyone's email address, so check-in staff do not get it.
 */
export async function listForEvent(user: UserDocument, eventId: string, { status }: { status?: RegistrationStatus }) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can see the attendee list');
  const registrations = await Registration.find({ event: event._id, ...(status ? { status } : {}) })
    .sort({ status: 1, createdAt: 1 })
    .populate<{ user: AttendeeUser | null }>('user', 'name email avatarUrl');

  const items = registrations.map((r) => ({
    id: r.id as string,
    status: r.status,
    registeredAt: r.createdAt,
    checkedInAt: r.checkedInAt,
    user: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email, avatarUrl: r.user.avatarUrl } : null,
  }));

  const counts = {
    going: items.filter((i) => i.status === REGISTRATION_STATUS.GOING).length,
    waitlisted: items.filter((i) => i.status === REGISTRATION_STATUS.WAITLISTED).length,
    checkedIn: items.filter((i) => i.checkedInAt).length,
  };
  return { items, counts };
}

/**
 * Who is expected at the door, for check-in staff: names and check-in state
 * only, never email addresses (those stay in the organiser's attendee list).
 * Lets the door check someone in by name when their phone can't show a code.
 */
export async function doorListForEvent(user: UserDocument, eventId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canCheckIn) throw forbidden('You cannot check people in for this event');
  const registrations = await Registration.find({ event: event._id, status: REGISTRATION_STATUS.GOING })
    .sort({ createdAt: 1 })
    .populate<{ user: Pick<UserDocument, 'id' | 'name' | 'avatarUrl'> | null }>('user', 'name avatarUrl');

  const items = registrations
    .filter((r) => r.user)
    .map((r) => ({
      id: r.id as string,
      checkedInAt: r.checkedInAt,
      user: { id: r.user!.id, name: r.user!.name, avatarUrl: r.user!.avatarUrl },
    }))
    .sort((a, b) => a.user.name.localeCompare(b.user.name));

  return { items, counts: { going: items.length, checkedIn: items.filter((i) => i.checkedInAt).length } };
}

/** Requires door rights rather than full management rights. */
export async function setCheckIn(user: UserDocument, eventId: string, attendeeId: string, checkedIn: boolean) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canCheckIn) throw forbidden('You cannot check people in for this event');
  const registration = await Registration.findOne({ event: event._id, user: attendeeId });
  if (!registration) throw notFound('This person is not registered for the event');
  if (registration.status !== REGISTRATION_STATUS.GOING) throw badRequest('Waitlisted attendees cannot be checked in');

  registration.checkedInAt = checkedIn ? new Date() : null;
  await registration.save();
  return { id: registration.id as string, status: registration.status, checkedInAt: registration.checkedInAt };
}

/** The user's own registrations ("my tickets"), soonest first. */
export async function listForUser(user: UserDocument, { upcomingOnly }: { upcomingOnly: boolean }) {
  const registrations = await Registration.find({ user: user.id }).select('event');
  const filter: FilterQuery<IEvent> = { _id: { $in: registrations.map((r) => r.event) } };
  if (upcomingOnly) filter.endsAt = { $gte: new Date() };
  filter.status = { $ne: EVENT_STATUS.DRAFT };

  const events = await Event.find(filter)
    .sort({ startsAt: upcomingOnly ? 1 : -1 })
    .populate('owner', OWNER_FIELDS);
  return withViewerContext(events, user);
}
