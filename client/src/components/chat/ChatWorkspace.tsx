'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEventsSync } from '@/context/EventContext';
import { meApi, organizerApi, type SyncEvent } from '@/lib/api';
import { formatDay } from '@/lib/format';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/surface';
import EventCover from '@/components/events/EventCover';
import { cn } from '@/lib/cn';
import EventChat from './EventChat';

/** Conversations (one per upcoming event you're part of) and the selected thread. */
export default function ChatWorkspace() {
  const { user } = useAuth();
  const { version } = useEventsSync();
  const [channels, setChannels] = useState<SyncEvent[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // On small screens show either the list or the thread.
  const [showThread, setShowThread] = useState(false);

  useEffect(() => {
    // Events you're going to, plus every event you help run (owners and
    // invited team members alike), past ones included.
    const runsEvents = user?.role === 'organizer' || user?.role === 'admin' || user?.isEventStaff;
    Promise.all([meApi.registrations(false), runsEvents ? organizerApi.overview().then((o) => o.events) : Promise.resolve([])])
      .then(([joined, organized]) => {
        const all = [...organized, ...joined].filter((e) => e.viewer.canChat);
        const unique = all.filter((e, i) => all.findIndex((x) => x.id === e.id) === i);
        const upcoming = unique.filter((e) => !e.isPast).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        const past = unique.filter((e) => e.isPast).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
        setChannels([...upcoming, ...past]);
        setActiveId((current) => current ?? upcoming[0]?.id ?? past[0]?.id ?? null);
      })
      .catch(() => setChannels([]));
  }, [user?.role, user?.isEventStaff, version]);

  if (channels === null) return <div className="h-[70vh] animate-pulse rounded-2xl bg-surface-muted" />;

  if (channels.length === 0) {
    return (
      <EmptyState
        emoji="💬"
        title="No conversations yet"
        description="Every event has a group chat with the organizer and everyone going. RSVP to an event to join its chat."
        action={<ButtonLink href="/explore" variant="secondary">Find an event</ButtonLink>}
      />
    );
  }

  const active = channels.find((c) => c.id === activeId);

  return (
    <div className="grid h-[calc(100dvh-23rem)] min-h-[460px] overflow-hidden rounded-[32px] border border-border bg-surface md:grid-cols-[19rem_1fr]">
      <nav className={cn('flex min-h-0 flex-col border-r border-border', showThread && 'hidden md:flex')}>
        <p className="border-b border-border px-5 py-4 font-display text-lg font-extrabold">Event chats</p>
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {channels.map((channel, i) => (
            <li key={channel.id}>
              {channel.isPast && !channels[i - 1]?.isPast && (
                <p className="px-3 pb-1 pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Past</p>
              )}
              <button
                onClick={() => {
                  setActiveId(channel.id);
                  setShowThread(true);
                }}
                className={cn('flex w-full items-center gap-3 rounded-2xl p-2 text-left transition', channel.id === activeId ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-muted')}
              >
                <EventCover event={channel} stickers={false} className="size-12 shrink-0 rounded-2xl" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{channel.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">{formatDay(channel.startsAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {active && (
        <section className={cn('flex min-h-0 flex-col', !showThread && 'hidden md:flex')}>
          <header className="flex items-center gap-3 border-b border-border px-4 py-3">
            <button onClick={() => setShowThread(false)} aria-label="Back to chats" className="rounded-lg p-1 text-muted hover:bg-surface-muted md:hidden">
              <ArrowLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-bold">{active.title}</p>
              <p className="text-xs text-muted">{formatDay(active.startsAt)} · {active.attendeeCount} going</p>
            </div>
            <Link href={`/events/${active.id}`} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground">
              Event <ExternalLink className="size-3.5" />
            </Link>
          </header>
          <EventChat key={active.id} eventId={active.id} canAnnounce={active.viewer.canManage} className="flex-1" />
        </section>
      )}
    </div>
  );
}
