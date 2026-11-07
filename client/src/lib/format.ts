import type { CategoryValue, NoteTag, Role, SyncEvent } from './api/types';

export const CATEGORY_LABELS: Record<CategoryValue, string> = {
  tech: 'Tech & Code',
  workshop: 'Workshop',
  cultural: 'Cultural',
  sports: 'Sports',
  meetup: 'Meetup',
  conference: 'Conference',
  social: 'Social',
  other: 'Other',
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as CategoryValue[];

export const NOTE_TAG_LABELS: Record<NoteTag, string> = {
  plan: 'Event Plan',
  speaker: 'Speaker',
  logistics: 'Logistics',
  ideas: 'Ideas',
  personal: 'Personal',
};
export const NOTE_TAGS = Object.keys(NOTE_TAG_LABELS) as NoteTag[];

export const ROLE_LABELS: Record<Role, string> = {
  member: 'Member',
  organizer: 'Organizer',
  admin: 'Super Admin',
};

/** Where people land after signing in; role-specific tools are reachable from there. */
export const APP_HOME = '/dashboard';

/** Cover art for events without a photo: a loud gradient per category. */
export const CATEGORY_GRADIENTS: Record<CategoryValue, string> = {
  tech: 'from-[#3df5ff] via-[#6a3dff] to-[#ff4fd8]',
  workshop: 'from-[#d4ff3a] via-[#3dffa0] to-[#3df5ff]',
  cultural: 'from-[#ff4fd8] via-[#ff7a1a] to-[#ffd23d]',
  sports: 'from-[#3dffa0] via-[#d4ff3a] to-[#ffd23d]',
  meetup: 'from-[#ff7a1a] via-[#ff4f8b] to-[#8b5cff]',
  conference: 'from-[#6a3dff] via-[#3d7bff] to-[#3df5ff]',
  social: 'from-[#ff4fd8] via-[#8b5cff] to-[#3df5ff]',
  other: 'from-[#9aa0b4] via-[#5d6478] to-[#2b2f3d]',
};

export const CATEGORY_EMOJI: Record<CategoryValue, string> = {
  tech: '💻',
  workshop: '🛠️',
  cultural: '🎭',
  sports: '⚽',
  meetup: '☕',
  conference: '🎤',
  social: '🎉',
  other: '✨',
};

export const NOTE_TAG_EMOJI: Record<NoteTag, string> = {
  plan: '🗺️',
  speaker: '🎙️',
  logistics: '📦',
  ideas: '💡',
  personal: '🫶',
};

/**
 * Every time in the app is shown in the campus time zone. The server renders
 * pages on Vercel in UTC, so formatting in "whatever zone this runtime is in"
 * showed UTC first and then jumped to local time after hydration. A fixed zone
 * gives the same text on the server and in every browser, and on a campus app
 * it is the zone the event actually happens in.
 */
export const CAMPUS_TIME_ZONE = process.env.NEXT_PUBLIC_CAMPUS_TIMEZONE || 'Asia/Kolkata';
const LOCALE = 'en-IN';

const dayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: CAMPUS_TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: CAMPUS_TIME_ZONE });
const fullFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: CAMPUS_TIME_ZONE });
const longFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: CAMPUS_TIME_ZONE,
  timeZoneName: 'short',
});
const dateKeyFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: CAMPUS_TIME_ZONE });

export const formatDay = (iso: string) => dayFormat.format(new Date(iso));
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => fullFormat.format(new Date(iso));
/** "Sunday, 8 November at 10:00 am IST", for link previews and anywhere the zone must be explicit. */
export const formatCampusDateTime = (iso: string) => longFormat.format(new Date(iso));
const stampFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: CAMPUS_TIME_ZONE });
/** { weekday: 'Sun', day: '8', month: 'Nov' } in the campus zone, for date stamps. */
export function campusDateParts(iso: string) {
  const parts = Object.fromEntries(stampFormat.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday ?? '', day: parts.day ?? '', month: parts.month ?? '' };
}

/** "2026-11-08": the campus calendar day an instant falls on. */
export const campusDateKey = (date: Date | string) => dateKeyFormat.format(new Date(date));

/** The zone's short name, e.g. "IST". */
export const campusZoneName = () =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: CAMPUS_TIME_ZONE, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value ?? CAMPUS_TIME_ZONE;

/** "Sat, 4 Oct · 10:00 – 16:00", or both dates when the event spans days. */
export function formatEventWhen(event: Pick<SyncEvent, 'startsAt' | 'endsAt'>): string {
  if (campusDateKey(event.startsAt) === campusDateKey(event.endsAt)) {
    return `${formatDay(event.startsAt)} · ${formatTime(event.startsAt)} – ${formatTime(event.endsAt)}`;
  }
  return `${formatDay(event.startsAt)} ${formatTime(event.startsAt)} – ${formatDay(event.endsAt)} ${formatTime(event.endsAt)}`;
}

export const formatVenue = (event: Pick<SyncEvent, 'venue' | 'onlineUrl'>) =>
  event.venue?.name || event.venue?.address || (event.onlineUrl ? 'Online' : 'Venue to be announced');

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "5 minutes ago", "yesterday". */
export function formatRelative(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** Minutes the campus zone is ahead of UTC at a given instant (330 for IST). */
function campusOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: CAMPUS_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** Date -> value for <input type="datetime-local">, as a campus wall-clock time. */
export function toDateTimeInput(date: Date): string {
  return new Date(date.getTime() + campusOffsetMinutes(date) * 60_000).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (campus wall-clock time) -> Date. */
export function fromDateTimeInput(value: string): Date {
  const asUtc = new Date(`${value}:00Z`);
  // Two passes settle the offset across a daylight-saving change.
  let guess = new Date(asUtc.getTime() - campusOffsetMinutes(asUtc) * 60_000);
  guess = new Date(asUtc.getTime() - campusOffsetMinutes(guess) * 60_000);
  return guess;
}
