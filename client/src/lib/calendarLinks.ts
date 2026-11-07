import type { SyncEvent } from './api/types.ts';

/** The web app's public address, the same on the server and in the browser (so links don't cause hydration mismatches). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

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

/** A WhatsApp message with the event's name, campus time and link, ready to send to a group. */
export function whatsappShareUrl(event: Pick<SyncEvent, 'id' | 'title'>, when: string, siteUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${event.title} · ${when}\nYou in? ${siteUrl}/events/${event.id}`)}`;
}
