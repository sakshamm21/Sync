import type { FilterQuery, Types } from 'mongoose';
import { Event, Registration, Team, type EventDocument, type IEvent, type UserDocument } from '../../models';
import * as notifications from '../notifications/notifications.service';
import type { RegisterBody } from './events.schemas';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { handOverSeat, hasWaitlist, clashesWith, claimOffer, type Clash } from './waitlist.service';
import { claimSeat, releaseSeat } from './seats';
import { formatCampusTime } from '../../lib/campusTime';
import { loadEvent, withViewerContext, present, OWNER_FIELDS, type PresentedEvent } from './events.policy';
import { EVENT_STATUS, NOTIFICATION_TYPES, REGISTRATION_STATUS, type RegistrationStatus } from '../../constants';

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

/** Checks answers against the event's questions; returns them in a tidy shape. */
function checkAnswers(event: EventDocument, answers: RegisterBody['answers']) {
  const given = new Map(answers.map((a) => [a.question, a.answer.trim()]));
  const tidy: { question: Types.ObjectId; answer: string }[] = [];
  for (const q of event.questions ?? []) {
    const answer = given.get(String(q._id)) ?? '';
    if (!answer) {
      if (q.required) throw badRequest(`Please answer: ${q.label}`, 'ANSWER_REQUIRED');
      continue;
    }
    if (q.kind === 'choice' && !q.options.includes(answer))
      throw badRequest(`Pick one of the options for: ${q.label}`, 'BAD_ANSWER');
    tidy.push({ question: q._id, answer });
  }
  return tidy;
}

/** Takes a seat if one is free and nobody is waiting, else joins the waitlist. */
async function seatOrWaitlist(event: EventDocument) {
  const gotSeat = !(await hasWaitlist(event._id)) && (await claimSeat(event._id));
  return { gotSeat, status: gotSeat ? REGISTRATION_STATUS.GOING : REGISTRATION_STATUS.WAITLISTED };
}

export async function register(
  user: UserDocument,
  eventId: string,
  { answers = [] }: Partial<RegisterBody> = {}
): Promise<RegistrationResponse> {
  const { event } = await loadEvent(user, eventId);
  if (!event.isOpenForRegistration()) throw badRequest('Registration is closed for this event', 'REGISTRATION_CLOSED');
  if (event.isCoOrganizer(user.id)) throw badRequest('You are organising this event', 'OWN_EVENT');
  const window = event.registrationWindowProblem();
  if (window && !(await Registration.exists({ event: event._id, user: user.id }))) {
    throw badRequest(
      window.code === 'REGISTRATION_NOT_OPEN'
        ? `Registration opens ${formatCampusTime(window.at)}`
        : 'Registration for this event has closed',
      window.code
    );
  }

  // Checked before claiming so the user sees the clash without a seat waitlisting first.
  const clashes = await clashesWith(user, event);

  const existing = await Registration.findOne({ event: event._id, user: user.id });
  if (!existing) {
    const tidyAnswers = checkAnswers(event, answers);
    // Selective events: the request waits for the organiser and holds no seat.
    // Otherwise nobody jumps the queue: while people are waiting, a new RSVP
    // waits too, even if a seat looks free for a moment.
    const { gotSeat, status } = event.requiresApproval
      ? { gotSeat: false, status: REGISTRATION_STATUS.PENDING }
      : await seatOrWaitlist(event);
    try {
      await Registration.create({ event: event._id, user: user._id, status, answers: tidyAnswers });
      if (status === REGISTRATION_STATUS.PENDING) {
        await notifications.notify(
          event.organizers.filter((id) => String(id) !== String(user._id)),
          {
            type: NOTIFICATION_TYPES.REGISTRATION_DECISION,
            title: `New request: ${event.title}`,
            body: `${user.name} asked to join. Approve or decline them in the attendee list.`,
            eventId: event._id,
          }
        );
      }
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

/** The organiser approves (seat or waitlist, as for any RSVP) or declines a request to join. */
export async function decide(user: UserDocument, eventId: string, attendeeId: string, approve: boolean) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organiser can approve requests');
  const request = await Registration.findOne({ event: event._id, user: attendeeId, status: REGISTRATION_STATUS.PENDING });
  if (!request) throw notFound('There is no pending request from this person');

  if (approve) {
    const { gotSeat, status } = await seatOrWaitlist(event);
    const updated = await Registration.updateOne({ _id: request._id, status: REGISTRATION_STATUS.PENDING }, { $set: { status } });
    if (!updated.modifiedCount && gotSeat) await releaseSeat(event._id);
  } else {
    await Registration.deleteOne({ _id: request._id });
  }
  await notifications.notify(
    [request.user],
    {
      type: NOTIFICATION_TYPES.REGISTRATION_DECISION,
      title: approve ? `Approved: ${event.title}` : `Not this time: ${event.title}`,
      body: approve
        ? "The organiser approved your request. It's on your schedule."
        : "The organiser couldn't fit you in this time.",
      eventId: event._id,
    },
    { email: true }
  );
  return listForEvent(user, eventId, {});
}

/** Claims a seat held for this user off the waitlist. */
export async function claim(user: UserDocument, eventId: string): Promise<RegistrationResponse> {
  const { event } = await loadEvent(user, eventId);
  if (!(await claimOffer(user._id, event._id))) {
    throw badRequest('There is no spot waiting for you, or the offer has expired', 'NO_OFFER');
  }
  const fresh = await loadEvent(user, eventId);
  return { ...(await present(fresh.event, user)), clashes: await clashesWith(user, fresh.event) };
}

export async function unregister(user: UserDocument, eventId: string) {
  const { event } = await loadEvent(user, eventId);
  // Once an event has started, registrations are its attendance record (check-ins,
  // the organiser's attendance rate, who may rate it), so they stay.
  if (event.startsAt <= new Date() && event.status !== EVENT_STATUS.CANCELLED) {
    throw badRequest('This event has already started, so you can no longer leave it', 'EVENT_STARTED');
  }
  const registration = await Registration.findOneAndDelete({ event: event._id, user: user.id });
  // Leaving the event also leaves its team (an empty team goes away).
  if (registration) {
    await Team.updateMany({ event: event._id, members: user._id }, { $pull: { members: user._id } });
    await Team.deleteMany({ event: event._id, members: { $size: 0 } });
  }
  if (!registration) throw notFound('You are not registered for this event', 'NOT_REGISTERED');

  // A held offer also holds a seat, so declining one passes it on too.
  if (registration.status === REGISTRATION_STATUS.GOING || registration.status === REGISTRATION_STATUS.OFFERED) {
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

  const labels = new Map((event.questions ?? []).map((q) => [String(q._id), q.label]));
  const items = registrations.map((r) => ({
    id: r.id as string,
    status: r.status,
    answers: (r.answers ?? []).map((a) => ({ question: labels.get(String(a.question)) ?? 'Removed question', answer: a.answer })),
    registeredAt: r.createdAt,
    checkedInAt: r.checkedInAt,
    user: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email, avatarUrl: r.user.avatarUrl } : null,
  }));

  const counts = {
    going: items.filter((i) => i.status === REGISTRATION_STATUS.GOING).length,
    waitlisted: items.filter((i) => i.status === REGISTRATION_STATUS.WAITLISTED).length,
    offered: items.filter((i) => i.status === REGISTRATION_STATUS.OFFERED).length,
    pending: items.filter((i) => i.status === REGISTRATION_STATUS.PENDING).length,
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

/** RSVPs to every upcoming date of a series at once; dates that refuse (full with approval, closed) are skipped. */
export async function registerSeries(user: UserDocument, eventId: string) {
  const { event } = await loadEvent(user, eventId);
  if (!event.seriesId) throw badRequest('This event is not part of a series', 'NOT_A_SERIES');
  const dates = await Event.find({ seriesId: event.seriesId, endsAt: { $gte: new Date() }, status: EVENT_STATUS.PUBLISHED }).sort(
    {
      startsAt: 1,
    }
  );
  const results: { id: string; status: string | null; error?: string }[] = [];
  for (const date of dates) {
    try {
      const r = await register(user, String(date._id));
      results.push({ id: String(date._id), status: r.viewer.registration });
    } catch (err) {
      results.push({ id: String(date._id), status: null, error: (err as Error).message });
    }
  }
  return results;
}
