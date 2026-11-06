'use client';

import { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import { type SyncEvent } from '@/lib/api';
import { formatDay, formatTime } from '@/lib/format';
import { TicketQr } from '@/components/events/QrTicket';
import { Kicker } from '@/components/ui/surface';

/** Entry codes for the next confirmed RSVP, so the door works without a list. */
export default function EntryCodes({ events }: { events: SyncEvent[] }) {
  const [upcoming, setUpcoming] = useState<SyncEvent | null>(null);

  useEffect(() => {
    const next = events
      .filter((e) => e.viewer.registration === 'going' && new Date(e.endsAt) > new Date())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    setUpcoming(next ?? null);
  }, [events]);

  // A private entry has nothing to scan.
  if (!upcoming || upcoming.visibility !== 'public') return null;

  return (
    <section className="space-y-4">
      <Kicker className="flex items-center gap-2">
        <QrCode className="size-4" /> Your entry code
      </Kicker>
      <div className="flex flex-col items-start gap-5 rounded-[28px] border border-border bg-surface p-6 sm:flex-row sm:items-center">
        <TicketQr event={upcoming} />
        <div className="min-w-0">
          <p className="font-display text-xl font-bold leading-tight">{upcoming.title}</p>
          <p className="mt-1 text-sm text-muted">
            {formatDay(upcoming.startsAt)} · {formatTime(upcoming.startsAt)}
          </p>
          <p className="mt-3 text-sm text-muted">Show this at the door. It only works for this event.</p>
        </div>
      </div>
    </section>
  );
}
