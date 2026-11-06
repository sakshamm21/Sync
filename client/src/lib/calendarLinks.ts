import type { SyncEvent } from './api/types.ts';

const stamp = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Opens Google Calendar's "new event" page filled in with this event. */
export function googleCalendarUrl(
  event: Pick<SyncEvent, 'id' | 'title' | 'description' | 'startsAt' | 'endsAt' | 'venue' | 'onlineUrl'>,
  siteUrl: string
): string {
  const location = [event.venue?.name, event.venue?.address].filter(Boolean).join(', ') || event.onlineUrl || '';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${stamp(event.startsAt)}/${stamp(event.endsAt)}`,
    details: `${event.description ? `${event.description}\n\n` : ''}${siteUrl}/events/${event.id}`,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
