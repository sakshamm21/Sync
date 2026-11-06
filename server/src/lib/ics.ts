/** Minimal RFC 5545 (iCalendar) writer for "Add to calendar" downloads. */

const formatDate = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const escapeText = (value = '') =>
  String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets must be folded onto continuation lines. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join('\r\n');
}

export interface CalendarEntry {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  startsAt: Date;
  endsAt: Date;
  cancelled?: boolean;
  /** When the event last changed; calendar apps use it to pick up edits. */
  updatedAt?: Date;
}

function eventLines({ uid, title, description, location, url, startsAt, endsAt, cancelled, updatedAt }: CalendarEntry) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatDate(new Date())}`,
    updatedAt ? `LAST-MODIFIED:${formatDate(updatedAt)}` : null,
    // Seconds since 2020 always grow when the event changes, as SEQUENCE must.
    updatedAt ? `SEQUENCE:${Math.max(0, Math.floor((updatedAt.getTime() - Date.UTC(2020, 0, 1)) / 1000))}` : null,
    `DTSTART:${formatDate(startsAt)}`,
    `DTEND:${formatDate(endsAt)}`,
    `SUMMARY:${escapeText(title)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    location ? `LOCATION:${escapeText(location)}` : null,
    url ? `URL:${url}` : null,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
  ];
}

/** A calendar of several events, e.g. a subscription feed. */
export function buildCalendar(entries: CalendarEntry[], { name }: { name?: string } = {}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sync//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    name ? `X-WR-CALNAME:${escapeText(name)}` : null,
    // Ask subscribed apps to check back hourly (most cap this at their own minimum).
    name ? 'REFRESH-INTERVAL;VALUE=DURATION:PT1H' : null,
    name ? 'X-PUBLISHED-TTL:PT1H' : null,
    ...entries.flatMap(eventLines),
    'END:VCALENDAR',
  ];
  return `${lines
    .filter((line): line is string => Boolean(line))
    .map(fold)
    .join('\r\n')}\r\n`;
}

/** One event, for an "Add to calendar" download. */
export const buildEventCalendar = (entry: CalendarEntry) => buildCalendar([entry]);
