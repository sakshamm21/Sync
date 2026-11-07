'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  Hourglass,
  Pencil,
  Search,
  Users,
} from 'lucide-react';
import { errorMessage, eventsApi, type Attendee, type AttendeeList, type EventInsights, type SyncEvent } from '@/lib/api';
import { formatDateTime, formatDay, formatEventWhen, formatVenue } from '@/lib/format';
import { useCreateEvent } from '@/components/events/CreateEventDialog';
import { useEventsSync } from '@/context/EventContext';
import EventCover from '@/components/events/EventCover';
import EventChat from '@/components/chat/EventChat';
import DoorScanner from '@/components/organizer/DoorScanner';
import DoorMode from '@/components/organizer/DoorMode';
import EventTeam from '@/components/organizer/EventTeam';
import Shifts from '@/components/organizer/Shifts';
import Budget from '@/components/organizer/Budget';
import TeamsCard from '@/components/teams/TeamsCard';
import { Button, ButtonLink } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, StatCard } from '@/components/ui/surface';
import { Segmented } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { saveBlob } from '@/lib/download';

type Filter = 'all' | 'pending' | 'going' | 'waitlisted' | 'checked-in';

function downloadCsv(event: SyncEvent, attendees: Attendee[]) {
  // A cell starting with = + - @ (or a tab/CR) is run as a formula by Excel and
  // Sheets; a leading apostrophe makes it plain text.
  const escape = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  // One column per question, so answers (roll number, T-shirt size, ...) line up.
  const questions = (event.questions ?? []).map((q) => q.label);
  const answerFor = (a: Attendee, label: string) => a.answers?.find((x) => x.question === label)?.answer ?? '';
  const rows = [
    ['Name', 'Email', 'Status', 'Registered at', 'Checked in at', ...questions],
    ...attendees.map((a) => [
      a.user?.name ?? '',
      a.user?.email ?? '',
      a.status,
      a.registeredAt,
      a.checkedInAt ?? '',
      ...questions.map((q) => answerFor(a, q)),
    ]),
  ];
  // The byte-order mark makes Excel read the file as UTF-8, so names like "Aanya Śarma" survive.
  const blob = new Blob(['\uFEFF', rows.map((r) => r.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, `${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-attendees.csv`);
}

/** RSVPs per day and how the event went, for its organisers. */
function Insights({ eventId, version }: { eventId: string; version: number }) {
  const [data, setData] = useState<EventInsights | null>(null);
  const [feedback, setFeedback] = useState<{ rating: number; comment: string }[]>([]);
  useEffect(() => {
    eventsApi
      .insights(eventId)
      .then(setData)
      .catch(() => setData(null));
    eventsApi
      .feedback(eventId)
      .then(setFeedback)
      .catch(() => setFeedback([]));
  }, [eventId, version]);
  if (!data || !data.rsvpsByDay.length) return null;
  const max = Math.max(...data.rsvpsByDay.map((d) => d.count));
  const facts = [
    `${data.interested} interested`,
    data.pending ? `${data.pending} awaiting approval` : null,
    data.showUpRate != null ? `${data.showUpRate}% showed up` : null,
    data.averageRating != null ? `rated ${data.averageRating}/5 by ${data.ratingCount}` : null,
  ].filter(Boolean);
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">RSVPs over time</h2>
        <p className="text-sm text-muted">{facts.join(' · ')}</p>
      </div>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={`RSVPs per day, peaking at ${max} in a day`}>
        {data.rsvpsByDay.map((d) => (
          <div key={d.day} className="group relative flex-1">
            <div className="rounded-t-md bg-primary" style={{ height: `${Math.max((d.count / max) * 100, 6)}%`, minHeight: 4 }} />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] text-background group-hover:block">
              {formatDay(`${d.day}T12:00:00Z`)}: {d.count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>{formatDay(`${data.rsvpsByDay[0].day}T12:00:00Z`)}</span>
        <span>{formatDay(`${data.rsvpsByDay[data.rsvpsByDay.length - 1].day}T12:00:00Z`)}</span>
      </div>
      {feedback.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-semibold">What attendees said</h3>
          <ul className="space-y-2">
            {feedback.map((f, i) => (
              <li key={i} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                <span className="mr-2 font-mono text-xs text-muted">{'★'.repeat(f.rating)}</span>
                {f.comment}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
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
    // The attendee list has everyone's email, so only managers get it; door
    // staff get door mode instead.
    eventsApi
      .get(eventId)
      .then(async (e) => {
        setEvent(e);
        if (e.viewer.canManage) setList(await eventsApi.attendees(eventId));
        else if (!e.viewer.canCheckIn) setError('You are not on the team for this event.');
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
      if (filter === 'pending' && a.status !== 'pending') return false;
      if (filter === 'checked-in' && !a.checkedInAt) return false;
      return !q || `${a.user?.name} ${a.user?.email}`.toLowerCase().includes(q);
    });
  }, [list, search, filter]);

  async function decide(attendee: Attendee, approve: boolean) {
    if (!attendee.user) return;
    try {
      setList(await eventsApi.decide(eventId, attendee.user.id, approve));
      toast.success(approve ? `${attendee.user.name} is in` : `Declined ${attendee.user.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function toggleCheckIn(attendee: Attendee) {
    if (!attendee.user) return;
    const checkedIn = !attendee.checkedInAt;
    // Optimistic: check-in at the door should feel instant.
    setList(
      (prev) =>
        prev && {
          items: prev.items.map((a) =>
            a.id === attendee.id ? { ...a, checkedInAt: checkedIn ? new Date().toISOString() : null } : a
          ),
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
    return (
      <EmptyState
        emoji="🫠"
        title="Event not available"
        description={error}
        action={
          <ButtonLink href="/organizer" variant="secondary">
            Back to organizer
          </ButtonLink>
        }
      />
    );
  }
  if (!event) return <div className="h-96 animate-pulse rounded-3xl bg-surface-muted" />;

  const header = (
    <>
      <Link href="/organizer" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> Organizer
      </Link>

      <Card className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
        <EventCover event={event} stickers={false} className="aspect-[16/10] w-full shrink-0 rounded-3xl sm:w-56" />
        <div className="min-w-0 flex-1">
          {event.status === 'cancelled' && (
            <Badge tone="danger" className="mb-2">
              Cancelled
            </Badge>
          )}
          {!event.viewer.canManage && <Badge className="mb-2">Door staff</Badge>}
          <h1 className="text-2xl font-semibold">{event.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {formatEventWhen(event)} · {formatVenue(event)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {event.viewer.canManage && event.status !== 'cancelled' && (
            <Button variant="secondary" onClick={() => openCreateEvent({ event })}>
              <Pencil /> Edit
            </Button>
          )}
          <ButtonLink href={`/events/${event.id}`} variant="ghost">
            <ExternalLink /> View
          </ButtonLink>
        </div>
      </Card>
    </>
  );

  if (!event.viewer.canManage) {
    return (
      <div className="space-y-8">
        {header}
        <DoorMode event={event} version={version} />
        {event.teamSize && <TeamsCard eventId={event.id} />}
        <Shifts event={event} />
      </div>
    );
  }
  if (!list) return <div className="h-96 animate-pulse rounded-3xl bg-surface-muted" />;

  return (
    <div className="space-y-8">
      {header}

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Going" value={`${list.counts.going}${event.capacity ? `/${event.capacity}` : ''}`} icon={<Users />} />
        <StatCard label="Waitlisted" value={list.counts.waitlisted} icon={<Hourglass />} />
        <StatCard label="Checked in" value={list.counts.checkedIn} icon={<CalendarCheck />} />
      </div>

      <Insights eventId={event.id} version={version} />
      {event.teamSize && <TeamsCard eventId={event.id} onCheckedIn={load} />}

      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold">Attendees</h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadCsv(event, list.items)}
              disabled={list.items.length === 0}
            >
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
                ...(event.requiresApproval
                  ? [{ value: 'pending' as Filter, label: `Requests (${list.counts.pending ?? 0})` }]
                  : []),
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
                    {a.answers?.length ? (
                      <p className="mt-0.5 truncate text-xs text-subtle">
                        {a.answers.map((x) => `${x.question}: ${x.answer}`).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  {a.status === 'pending' ? (
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" onClick={() => decide(a, true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(a, false)}>
                        Decline
                      </Button>
                    </div>
                  ) : a.status === 'waitlisted' ? (
                    <Badge tone="warning">
                      <Hourglass /> Waitlisted
                    </Badge>
                  ) : a.status === 'offered' ? (
                    <Badge tone="warning">
                      <Hourglass /> Offered a spot
                    </Badge>
                  ) : (
                    <button
                      onClick={() => toggleCheckIn(a)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                        a.checkedInAt
                          ? 'border-transparent bg-success-soft text-success'
                          : 'border-border text-muted hover:border-border-strong hover:text-foreground'
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

      <div className="grid gap-6 xl:grid-cols-2">
        <EventTeam eventId={event.id} />
        <Card className="p-5">
          <h2 className="font-semibold">Door check-in</h2>
          <p className="mb-4 mt-0.5 text-xs text-muted">
            Attendees show the code on their event page. Scanning one checks them in.
          </p>
          <DoorScanner event={event} onScanned={load} />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Shifts event={event} />
        <Budget eventId={event.id} />
      </div>
    </div>
  );
}
