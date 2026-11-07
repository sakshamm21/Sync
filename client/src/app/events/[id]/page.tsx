/**
 * Server-rendered event page.
 *
 * A shared event link is how this app spreads, so the page has to produce a
 * real title, description and preview image before any JavaScript runs. The
 * public details are fetched here and handed to the client island, which owns
 * everything that needs a signed-in user (RSVP, chat, entry code).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PublicHeader from '@/components/shell/PublicHeader';
import { AmbientGlow } from '@/components/shell/AppShell';
import EventDetails from '@/components/events/EventDetails';
import { CATEGORY_LABELS, formatCampusDateTime } from '@/lib/format';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

/** The fields needed for metadata and the first paint. No auth, so a shared link works. */
export interface PublicEvent {
  id: string;
  title: string;
  description: string;
  category: string;
  startsAt: string;
  endsAt: string;
  status: string;
  visibility: string;
  coverImageUrl: string;
  attendeeCount: number;
  capacity: number | null;
  venue: { name?: string; address?: string };
  owner: { name?: string; organization?: string; avatarUrl?: string };
}

async function fetchPublicEvent(id: string): Promise<PublicEvent | null> {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  try {
    const response = await fetch(`${API_URL}/api/events/${id}`, {
      // Public data changes only when an organiser edits it; a short window
      // keeps the page fast without showing a stale cancellation for long.
      next: { revalidate: 60 },
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: PublicEvent };
    // Private events are only visible to their owner; never render them here.
    return body.data?.visibility === 'public' ? body.data : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const event = await fetchPublicEvent(id);

  if (!event) {
    // Private plans and drafts render client-side for their owner; never index them.
    return { title: 'Event', robots: { index: false, follow: false } };
  }

  const host = event.owner?.organization || event.owner?.name || 'Sync';
  // Link previews are read on phones on campus, so state the campus time with its zone.
  const when = formatCampusDateTime(event.startsAt);
  const where = event.venue?.name || event.venue?.address;
  const description =
    event.description?.trim() || `${event.title} on ${when}${where ? ` at ${where}` : ''}. Hosted by ${host} on Sync.`;
  const url = `${SITE_URL}/events/${event.id}`;
  // A cancelled event should not look like an invitation in a chat preview.
  const suffix = event.status === 'cancelled' ? ' · Cancelled' : '';

  return {
    // The root layout's template already appends " · Sync".
    title: event.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'Sync',
      title: `${event.title}${suffix}`,
      description,
      url,
      images: event.coverImageUrl ? [{ url: event.coverImageUrl, width: 1200, height: 630, alt: event.title }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${event.title}${suffix}`,
      description,
      images: event.coverImageUrl ? [event.coverImageUrl] : undefined,
    },
  };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  // Null for private plans and drafts: the client fetches those with the user's session.
  const publicEvent = await fetchPublicEvent(id);
  const categoryLabel = publicEvent ? CATEGORY_LABELS[publicEvent.category as keyof typeof CATEGORY_LABELS] : '';

  return (
    <div className="min-h-screen">
      <AmbientGlow />
      <PublicHeader />
      <EventDetails id={id} initialEvent={publicEvent} initialCategoryLabel={categoryLabel ?? ''} />
    </div>
  );
}
