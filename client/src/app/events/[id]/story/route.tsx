/**
 * A 1080×1920 image of an event for Instagram (or WhatsApp) Stories
 * (Roadmap "Later": an Instagram story card for each event).
 */
import { ImageResponse } from 'next/og';
import { fetchPublicEvent } from '../publicEvent';
import { formatCampusDateTime } from '@/lib/format';

const COLORS: Record<string, [string, string]> = {
  tech: ['#3df5ff', '#6a3dff'],
  workshop: ['#d4ff3a', '#3dffa0'],
  cultural: ['#ff4fd8', '#ff7a1a'],
  sports: ['#3dffa0', '#d4ff3a'],
  meetup: ['#ff7a1a', '#8b5cff'],
  conference: ['#6a3dff', '#3df5ff'],
  social: ['#ff4fd8', '#3df5ff'],
  other: ['#9aa0b4', '#2b2f3d'],
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await fetchPublicEvent(id);
  if (!event) return new Response('Not found', { status: 404 });
  const [a, b] = COLORS[event.category] ?? COLORS.other;
  const host = event.owner?.organization || event.owner?.name || 'Sync';
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'sync').replace(/^https?:\/\//, '').replace(/\/$/, '');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '120px 90px',
        background: `linear-gradient(160deg, ${a}, ${b})`,
        color: '#09090d',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', fontSize: 56, fontWeight: 800 }}>sync.</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: event.title.length > 30 ? 96 : 120, fontWeight: 800, lineHeight: 1 }}>
          {event.title}
        </div>
        <div style={{ display: 'flex', fontSize: 52, marginTop: 48, fontWeight: 600 }}>
          {formatCampusDateTime(event.startsAt)}
        </div>
        {event.venue?.name && <div style={{ display: 'flex', fontSize: 48, marginTop: 16 }}>{event.venue.name}</div>}
        <div style={{ display: 'flex', fontSize: 40, marginTop: 16, opacity: 0.8 }}>by {host}</div>
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 40,
          fontWeight: 700,
          background: '#09090d',
          color: '#f5f2ea',
          padding: '24px 40px',
          borderRadius: 999,
          alignSelf: 'flex-start',
        }}
      >
        RSVP on {site}
      </div>
    </div>,
    { width: 1080, height: 1920 }
  );
}
