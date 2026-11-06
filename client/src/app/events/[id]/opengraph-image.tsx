/**
 * The picture shown when an event link is shared (WhatsApp, Slack, X):
 * title, campus date and time, venue and host on the category's colours,
 * with the event's own photo behind it when it has one. Events without a
 * photo used to share as plain text.
 */
import { ImageResponse } from 'next/og';
import { fetchPublicEvent } from './publicEvent';
import { formatCampusDateTime } from '@/lib/format';

export const alt = 'Event on Sync';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GRADIENTS: Record<string, [string, string, string]> = {
  tech: ['#3df5ff', '#6a3dff', '#ff4fd8'],
  workshop: ['#d4ff3a', '#3dffa0', '#3df5ff'],
  cultural: ['#ff4fd8', '#ff7a1a', '#ffd23d'],
  sports: ['#3dffa0', '#d4ff3a', '#ffd23d'],
  meetup: ['#ff7a1a', '#ff4f8b', '#8b5cff'],
  conference: ['#6a3dff', '#3d7bff', '#3df5ff'],
  social: ['#ff4fd8', '#8b5cff', '#3df5ff'],
  other: ['#9aa0b4', '#5d6478', '#2b2f3d'],
};

/** The cover as a data URL, or null if it can't be fetched quickly (a broken link must not break the preview). */
async function coverDataUrl(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(png|jpe?g|gif|webp)/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 4_000_000) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await fetchPublicEvent(id);
  const [a, b, c] = GRADIENTS[event?.category ?? 'other'] ?? GRADIENTS.other;
  const cover = event?.coverImageUrl ? await coverDataUrl(event.coverImageUrl) : null;
  const host = event?.owner?.organization || event?.owner?.name || 'Sync';
  const where = event?.venue?.name || event?.venue?.address || '';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: `linear-gradient(135deg, ${a}, ${b} 55%, ${c})`,
        fontFamily: 'sans-serif',
      }}
    >
      {cover && (
        <img
          src={cover}
          alt=""
          width={1200}
          height={630}
          style={{ position: 'absolute', top: 0, left: 0, width: 1200, height: 630, objectFit: 'cover' }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          // The image renderer (Satori) ignores inset, so the size is spelled out.
          top: 0,
          left: 0,
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: '64px 72px',
          background: 'linear-gradient(180deg, rgba(9,9,13,0.05) 0%, rgba(9,9,13,0.55) 45%, rgba(9,9,13,0.92) 100%)',
          color: '#f5f2ea',
        }}
      >
        {event?.status === 'cancelled' && (
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: '#ff4f6d', marginBottom: 12 }}>CANCELLED</div>
        )}
        <div style={{ display: 'flex', fontSize: event && event.title.length > 40 ? 64 : 80, fontWeight: 800, lineHeight: 1.02 }}>
          {event?.title ?? 'Sync'}
        </div>
        {event && (
          <div style={{ display: 'flex', fontSize: 34, marginTop: 24, color: '#d4ff3a' }}>
            {formatCampusDateTime(event.startsAt)}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 28, marginTop: 10, color: 'rgba(245,242,234,0.85)' }}>
          {[where, `by ${host}`].filter(Boolean).join(' · ')}
        </div>
        <div style={{ display: 'flex', position: 'absolute', top: 56, right: 72, fontSize: 34, fontWeight: 800 }}>sync.</div>
      </div>
    </div>,
    size
  );
}
