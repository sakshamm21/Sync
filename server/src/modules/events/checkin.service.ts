/**
 * Door check-in by QR code.
 *
 * Each confirmed registration gets a short-lived signed token. The attendee
 * shows it on their phone; the organiser's phone scans it and the server
 * checks the person in. The token names no private data and cannot be forged,
 * and it stops working once the event is over.
 */
import jwt, { type JwtPayload } from 'jsonwebtoken';
import env from '../../config/env';
import { badRequest } from '../../lib/errors';
import { Registration, type UserDocument } from '../../models';
import { loadEvent } from './events.policy';
import { REGISTRATION_STATUS } from '../../constants';

const TICKET_TTL_SECONDS = 60 * 60 * 24 * 14;

export interface TicketPayload extends JwtPayload {
  /** The registration this ticket admits. */
  reg: string;
  event: string;
  user: string;
}

/** The signed ticket for one registration, or null when there isn't one. */
export async function ticketFor(user: UserDocument, eventId: string): Promise<{ token: string; payload: TicketPayload } | null> {
  const { event } = await loadEvent(user, eventId);
  const registration = await Registration.findOne({ event: event._id, user: user.id });
  // Only a confirmed attendee has something to scan.
  if (!registration || registration.status !== REGISTRATION_STATUS.GOING) return null;

  const token = jwt.sign(
    { reg: String(registration._id), event: String(event._id), user: String(user._id) },
    env.jwtSecret,
    { expiresIn: TICKET_TTL_SECONDS }
  );
  return { token, payload: jwt.decode(token) as TicketPayload };
}

/** Scans a ticket and checks that person in. Idempotent: scanning twice is fine. */
export async function checkInByTicket(organiser: UserDocument, eventId: string, token: string) {
  const { event, access } = await loadEvent(organiser, eventId);
  if (!access.canCheckIn) throw badRequest('You cannot check people in for this event');

  let payload: TicketPayload;
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded === 'string' || !decoded.reg) throw new Error('Malformed ticket');
    payload = decoded as TicketPayload;
  } catch {
    throw badRequest('That ticket could not be read. Ask them to refresh it.', 'BAD_TICKET');
  }

  // A ticket is only good for the event it was issued for.
  if (String(payload.event) !== String(event._id)) {
    throw badRequest('That ticket is for a different event', 'WRONG_EVENT');
  }

  const registration = await Registration.findById(payload.reg)
    .populate<{ user: { name: string; avatarUrl: string } | null }>('user', 'name avatarUrl');

  if (!registration || String(registration.event) !== String(event._id)) {
    throw badRequest('This ticket is no longer valid', 'UNKNOWN_TICKET');
  }
  if (registration.status !== REGISTRATION_STATUS.GOING) {
    throw badRequest('This person is on the waitlist, not confirmed', 'WAITLISTED');
  }

  const alreadyIn = Boolean(registration.checkedInAt);
  if (!alreadyIn) {
    registration.checkedInAt = new Date();
    await registration.save();
  }

  return {
    ok: true as const,
    alreadyCheckedIn: alreadyIn,
    checkedInAt: registration.checkedInAt,
    attendee: registration.user ? { name: registration.user.name, avatarUrl: registration.user.avatarUrl } : null,
  };
}