'use client';

import Link from 'next/link';
import type { SyncEvent } from '@/lib/api';
import { campusDateParts, formatTime, formatVenue } from '@/lib/format';
import { Tilt } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import EventCover from './EventCover';
import RsvpButton from './RsvpButton';

/** Big stamped date: weekday, giant day number, month. */
export function DateStamp({ iso, className }: { iso: string; className?: string }) {
  const d = campusDateParts(iso);
  return (
    <div className={cn('flex w-14 shrink-0 flex-col items-center text-center leading-none', className)}>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted">{d.weekday}</span>
      <span className="my-0.5 font-display text-[2.6rem] font-extrabold tabular-nums tracking-tighter">{d.day}</span>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">{d.month}</span>
    </div>
  );
}

export function CapacityBar({ event }: { event: SyncEvent }) {
  if (event.capacity == null) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
        🔥 {event.attendeeCount} going{event.interestedCount ? ` · ${event.interestedCount} interested` : ''}
      </span>
    );
  }
  const ratio = Math.min(event.attendeeCount / event.capacity, 1);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-muted">
        <span>
          {event.spotsLeft === 0 ? 'Full' : `${event.spotsLeft} spots`}
          {event.interestedCount ? ` · ${event.interestedCount} interested` : ''}
        </span>
        <span className="tabular-nums">
          {event.attendeeCount}/{event.capacity}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700',
            ratio >= 1 ? 'bg-pink' : ratio > 0.75 ? 'bg-orange' : 'bg-primary'
          )}
          style={{ width: `${Math.max(ratio * 100, 4)}%` }}
        />
      </div>
    </div>
  );
}

/** An event as a ticket: cover on top, perforated stub with the date below. */
export default function EventCard({
  event,
  onChange,
  className,
}: {
  event: SyncEvent;
  onChange: (event: SyncEvent) => void;
  className?: string;
}) {
  const host = event.owner.organization || event.owner.name;
  return (
    <Tilt className={cn('group h-full rounded-[28px] [filter:drop-shadow(0_20px_30px_rgb(0_0_0/0.25))]', className)}>
      <article className="flex h-full flex-col">
        <Link href={`/events/${event.id}`} aria-label={event.title} className="ticket-top block overflow-hidden rounded-t-[28px]">
          <EventCover event={event} className="aspect-[16/10]" />
        </Link>
        <div className="ticket-bottom relative flex flex-1 flex-col rounded-b-[28px] bg-surface p-4 pt-5">
          <div aria-hidden="true" className="absolute inset-x-5 top-0 border-t-2 border-dashed border-border" />
          <div className="flex gap-4">
            <DateStamp iso={event.startsAt} />
            <div className="min-w-0 flex-1 border-l border-border pl-4">
              <Link
                href={`/events/${event.id}`}
                className="line-clamp-2 font-display text-lg font-bold leading-tight transition-colors hover:text-primary"
              >
                {event.title}
              </Link>
              <p className="mt-1.5 truncate font-mono text-[11px] uppercase tracking-wider text-muted">
                {formatTime(event.startsAt)} · {formatVenue(event)}
              </p>
              <p className="mt-0.5 truncate text-xs text-subtle">by {host}</p>
            </div>
          </div>
          <div className="mt-auto flex items-end gap-3 pt-4">
            <CapacityBar event={event} />
            <RsvpButton event={event} onChange={onChange} className="shrink-0" />
          </div>
        </div>
      </article>
    </Tilt>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[28px]">
      <div className="aspect-[16/10] animate-pulse bg-surface-muted" />
      <div className="flex gap-4 bg-surface p-4">
        <div className="h-16 w-14 animate-pulse rounded-xl bg-surface-muted" />
        <div className="flex-1 space-y-2.5">
          <div className="h-4 w-3/4 animate-pulse rounded-full bg-surface-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded-full bg-surface-muted" />
          <div className="h-8 w-full animate-pulse rounded-full bg-surface-muted" />
        </div>
      </div>
    </div>
  );
}
