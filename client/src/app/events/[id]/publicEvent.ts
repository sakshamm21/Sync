/** The public copy of an event, fetched without a session (shared links, previews). */
const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

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

export async function fetchPublicEvent(id: string): Promise<PublicEvent | null> {
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
