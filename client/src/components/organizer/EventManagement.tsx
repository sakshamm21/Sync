'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { ArrowLeft, CalendarCheck, CheckCircle2, Circle, Download, ExternalLink, Hourglass, Pencil, Search, Users } from 'lucide-react';
import { errorMessage, eventsApi, type Attendee, type AttendeeList, type SyncEvent } from '@/lib/api';
import { formatDateTime, formatEventWhen, formatVenue } from '@/lib/format';
import { useCreateEvent } from '@/components/events/CreateEventDialog';
import { useEventsSync } from '@/context/EventContext';
import EventCover from '@/components/events/EventCover';
import EventChat from '@/components/chat/EventChat';
import QrScanner from '@/components/events/QrTicket';
import EventTeam from '@/components/organizer/EventTeam';
import { Button, ButtonLink } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, StatCard } from '@/components/ui/surface';
import { Segmented } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'going' | 'waitlisted' | 'checked-in';

function downloadCsv(event: SyncEvent, attendees: Attendee[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = [
    ['Name', 'Email', 'Status', 'Registered at', 'Checked in at'],
    ...attendees.map((a) => [a.user?.name ?? '', a.user?.email ?? '', a.status, a.registeredAt, a.checkedInAt ?? '']),
  ];
  const blob = new Blob([rows.map((r) => r.map(escape).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-attendees.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Organiser view of one event: attendees, check-in and announcements. */
export default function EventManagement({ eventId }: { eventId: string }) {
  const { openCreateEvent } = useCreateEvent();
  const { version } = useEventsSync();
  const [event, setEvent] = useState<SyncEvent | null>(null);
  const [list, setList] = useState<AttendeeList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(() => {
    Promise.all([eventsApi.get(eventId), eventsApi.attendees(eventId)])
      .then(([e, a]) => {
        setEvent(e);
        setList(a);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [eventId]);
  useEffect(load, [load, version]);

  const visible = useMemo(() => {
    if (!list) return [];
    const q = search.trim().toLowerCase();
    return list.items.filter((a) => {
      if (filter === 'going' && a.status !== 'going') return false;
      if (filter === 'waitlisted' && a.status !== 'waitlisted') return false;
      if (filter === 'checked-in' && !a.checkedInAt) return false;
      return !q || `${a.user?.name} ${a.user?.email}`.toLowerCase().includes(q);
    });
  }, [list, search, filter]);

  async function toggleCheckIn(attendee: Attendee) {
    if (!attendee.user) return;
    const checkedIn = !attendee.checkedInAt;
    // Optimistic: check-in at the door should feel instant.
    setList((prev) =>
      prev && {
        items: prev.items.map((a) => (a.id === attendee.id ? { ...a, checkedInAt: checkedIn ? new Date().toISOString() : null } : a)),
        counts: { ...prev.counts, checkedIn: prev.counts.checkedIn + (checkedIn ? 1 : -1) },
      }
    );
    try {
      await eventsApi.setCheckIn(eventId, attendee.user.id, checkedIn);
    } catch (err) {
      toast.error(errorMessage(err));
      load();
    }
  }

  if (error) {
    return <EmptyState emoji="🫠" title="Event not available" description={error} action={<ButtonLink href="/organizer" variant="secondary">Back to organizer</ButtonLink>} />;
  }
  if (!event || !list) return <div className="h-96 animate-pulse rounded-3xl bg-surface-muted" />;

  return (
    <div className="space-y-8">
      <Link href="/organizer" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> Organizer
      </Link>

      <Card className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
        <EventCover event={event} stickers={false} className="aspect-[16/10] w-full shrink-0 rounded-3xl sm:w-56" />
        <div className="min-w-0 flex-1">
          {event.status === 'cancelled' && <Badge tone="danger" className="mb-2">Cancelled</Badge>}
          <h1 className="text-2xl font-semibold">{event.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {formatEventWhen(event)} · {formatVenue(event)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {event.status !== 'cancelled' && (
            <Button variant="secondary" onClick={() => openCreateEvent({ event })}>
              <Pencil /> Edit
            </Button>
          )}
          <ButtonLink href={`/events/${event.id}`} variant="ghost">
            <ExternalLink /> View
          </ButtonLink>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Going" value={`${list.counts.going}${event.capacity ? `/${event.capacity}` : ''}`} icon={<Users />} />
        <StatCard label="Waitlisted" value={list.counts.waitlisted} icon={<Hourglass />} />
        <StatCard label="Checked in" value={list.counts.checkedIn} icon={<CalendarCheck />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold">Attendees</h2>
            <Button variant="secondary" size="sm" onClick={() => downloadCsv(event, list.items)} disabled={list.items.length === 0}>
              <Download /> Export CSV
            </Button>
          </div>
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <input
                type="search"
                placeholder="Find by name or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search attendees"
                className="h-10 w-full rounded-xl border border-border bg-surface-muted pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-surface focus:ring-4 focus:ring-ring/20"
              />
            </div>
            <Segmented<Filter>
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'going', label: 'Going' },
                { value: 'waitlisted', label: 'Waitlist' },
                { value: 'checked-in', label: 'Checked in' },
              ]}
            />
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted">
              {list.items.length === 0 ? 'No registrations yet. Share the event page to get RSVPs.' : 'No one matches.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((a) => (
                <motion.li layout key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={a.user?.name ?? '?'} src={a.user?.avatarUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.user?.name ?? 'Deleted user'}</p>
                    <p className="truncate text-xs text-muted">
                      {a.user?.email} · registered {formatDateTime(a.registeredAt)}
                    </p>
                  </div>
                  {a.status === 'waitlisted' ? (
                    <Badge tone="warning"><Hourglass /> Waitlisted</Badge>
                  ) : (
                    <button
                      onClick={() => toggleCheckIn(a)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                        a.checkedInAt ? 'border-transparent bg-success-soft text-success' : 'border-border text-muted hover:border-border-strong hover:text-foreground'
                      )}
                    >
                      {a.checkedInAt ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                      {a.checkedInAt ? 'Checked in' : 'Check in'}
                    </button>
                  )}
                </motion.li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex h-[640px] flex-col overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Announcements & chat</h2>
            <p className="mt-0.5 text-xs text-muted">Announcements notify every attendee in the app and by email.</p>
          </div>
          {event.viewer.canChat ? (
            <EventChat eventId={event.id} canAnnounce className="flex-1" />
          ) : (
            <p className="p-6 text-sm text-muted">Chat opens once the event is published.</p>
          )}
        </Card>
      </div>

            {event.viewer.canManage && <EventTeam eventId={event.id} />}

            {event.viewer.canCheckIn && (
              <Card className="p-5">
                <h2 className="font-semibold">Door check-in</h2>
                <p className="mt-0.5 mb-4 text-xs text-muted">
                  Attendees show the code on their event page. Scanning one checks them in.
                </p>
                <QrScanner event={event} onScanned={load} />
              </Card>
            )}
          </div>
        );
      }
