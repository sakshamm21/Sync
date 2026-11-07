import Link from 'next/link';
import type { SyncEvent } from '@/lib/api';
import { formatTime, formatVenue } from '@/lib/format';
import { cn } from '@/lib/cn';
import EventCover, { statusOf } from './EventCover';
import { DateStamp } from './EventCard';

/** Horizontal ticket: thumbnail | perforation | date + details. Sits on the page background. */
export default function MiniTicket({ event, className }: { event: SyncEvent; className?: string }) {
  const status = statusOf(event);
  return (
    <Link
      href={`/events/${event.id}`}
      className={cn(
        'group relative flex h-32 w-[22rem] shrink-0 snap-start overflow-hidden rounded-[24px] border border-border bg-surface transition hover:-translate-y-1 hover:border-border-strong',
        className
      )}
    >
      <EventCover event={event} stickers={false} className="w-28 shrink-0" />
      <div className="relative flex min-w-0 flex-1 items-center gap-3 border-l-2 border-dashed border-border py-3 pl-3 pr-4">
        {/* Perforation bites */}
        <span
          aria-hidden="true"
          className="absolute -left-[11px] -top-[11px] size-5 rounded-full border border-border bg-background"
        />
        <span
          aria-hidden="true"
          className="absolute -bottom-[11px] -left-[11px] size-5 rounded-full border border-border bg-background"
        />
        <DateStamp iso={event.startsAt} className="w-12" />
        <div className="min-w-0">
          <p className="line-clamp-2 font-display text-base font-bold leading-tight">{event.title}</p>
          <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-wider text-muted">
            {formatTime(event.startsAt)} · {formatVenue(event)}
          </p>
          {status && (
            <span className={cn('mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold', status.className)}>
              {status.label}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
