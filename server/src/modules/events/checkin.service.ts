/**
 * Door check-in by QR code.
 *
 * Each confirmed registration has a ticket: its id plus an HMAC that only the
 * server can make. The attendee shows it on their phone; the door's phone scans
 * it and the server checks the person in. A ticket is short (about 40
 * characters), so its QR code is small and scans quickly off a dim screen. It
 * names no private data, cannot be forged, and is only honoured while the
 * registration is still confirmed for this event.
 */
import crypto from 'node:crypto';
import env from '../../config/env';
import { badRequest, forbidden } from '../../lib/errors';
import { Registration, type UserDocument } from '../../models';
import { loadEvent } from './events.policy';
import { EVENT_STATUS, REGISTRATION_STATUS } from '../../constants';

/** Scans keep working this long after the end, for late check-ins at the door. */
const SCAN_GRACE_MS = 6 * 60 * 60 * 1000;
const TICKET_VERSION = 't1';

/** A key used only for tickets, derived from the main secret with its own purpose string. */
const ticketKey = () => crypto.createHmac('sha256', env.jwtSecret).update('sync:ticket-key').digest();

const signature = (registrationId: string, eventId: string) =>
  crypto
    .createHmac('sha256', ticketKey())
    .update(`${TICKET_VERSION}:${registrationId}:${eventId}`)
    .digest('base64url')
    .slice(0, 22);

/** `t1.<registration id as base64url>.<signature>` */
export function makeTicket(registrationId: string, eventId: string): string {
  const id = Buffer.from(registrationId, 'hex').toString('base64url');
  return `${TICKET_VERSION}.${id}.${signature(registrationId, eventId)}`;
}

/** Returns the registration id if the ticket was made for this event, else null. */
export function readTicket(token: string, eventId: string): string | null {
  const [version, id, sig] = token.trim().split('.');
  if (version !== TICKET_VERSION || !id || !sig) return null;
  const registrationId = Buffer.from(id, 'base64url').toString('hex');
  if (!/^[0-9a-f]{24}$/.test(registrationId)) return null;
  const expected = Buffer.from(signature(registrationId, eventId));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return registrationId;
}

/** The ticket for one registration, or null when there isn't one. */
export async function ticketFor(user: UserDocument, eventId: string): Promise<{ token: string } | null> {
  const { event } = await loadEvent(user, eventId);
  const registration = await Registration.findOne({ event: event._id, user: user.id });
  // Only a confirmed attendee has something to scan.
  if (!registration || registration.status !== REGISTRATION_STATUS.GOING) return null;
  return { token: makeTicket(String(registration._id), String(event._id)) };
}

/** Scans a ticket and checks that person in. Idempotent: scanning twice is fine. */
export async function checkInByTicket(organiser: UserDocument, eventId: string, token: string) {
  const { event, access } = await loadEvent(organiser, eventId);
  if (!access.canCheckIn) throw forbidden('You cannot check people in for this event');
  if (event.status === EVENT_STATUS.CANCELLED) throw badRequest('This event was cancelled', 'EVENT_CANCELLED');
  if (event.endsAt.getTime() + SCAN_GRACE_MS < Date.now()) throw badRequest('This event is over', 'EVENT_ENDED');

  const registrationId = readTicket(token, String(event._id));
  if (!registrationId) {
    throw badRequest("That code isn't a ticket for this event. Ask them to open it from the event page.", 'BAD_TICKET');
  }

  const registration = await Registration.findById(registrationId).populate<{ user: { name: string; avatarUrl: string } | null }>(
    'user',
    'name avatarUrl'
  );

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
