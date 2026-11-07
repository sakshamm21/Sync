'use client';

import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { eventsApi, type SyncEvent } from '@/lib/api';

/** A QR code as one SVG path, with the quiet zone readers need around it. */
export function QrSvg({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    // Type 0 picks the smallest version that fits; M recovers from ~15% damage (a cracked screen).
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
    return { size: count + quiet * 2, path: d };
  }, [text]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label="Entry code">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/** The code this person shows at the door. */
export function TicketQr({ event }: { event: SyncEvent }) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    eventsApi
      .ticket(event.id)
      .then((ticket) => {
        if (cancelled) return;
        setToken(ticket?.token ?? null);
        setState(ticket ? 'ready' : 'none');
      })
      .catch(() => !cancelled && setState('failed'));
    return () => {
      cancelled = true;
    };
  }, [event.id, event.viewer.registration]);

  if (state === 'loading') return <div className="size-52 animate-pulse rounded-2xl bg-surface-muted" />;
  if (state === 'failed') return <p className="text-sm text-muted">Could not load your entry code.</p>;
  if (state === 'none' || !token) return <p className="text-sm text-muted">Only confirmed attendees have an entry code.</p>;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl bg-white p-2 shadow-inner">
        <QrSvg text={token} className="size-56" />
      </div>
      <p className="max-w-[16rem] text-center text-xs text-muted">Show this at the door. Turn your screen brightness up if it won&apos;t scan.</p>
    </div>
  );
}
