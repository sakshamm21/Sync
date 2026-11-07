'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Ban, CalendarCheck, CalendarDays, Hourglass, Pencil, Plus, ScanLine, Trash2, TrendingUp, Users } from 'lucide-react';
import { useEventsSync } from '@/context/EventContext';
import { errorMessage, eventsApi, organizerApi, type OrganizedEvent, type OrganizerOverview } from '@/lib/api';
import { formatEventWhen, formatVenue } from '@/lib/format';
import { useCreateEvent } from '@/components/events/CreateEventDialog';
import EventCover from '@/components/events/EventCover';
import { Button, ButtonLink } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/overlay';
import { Badge, EmptyState, PageHeader, StatCard } from '@/components/ui/surface';
import { Segmented } from '@/components/ui/tabs';
import { Stagger, StaggerItem } from '@/components/ui/motion';

type Filter = 'upcoming' | 'drafts' | 'past' | 'cancelled';

const matches: Record<Filter, (e: OrganizedEvent) => boolean> = {
  upcoming: (e) => e.status === 'published' && !e.isPast,
  drafts: (e) => e.status === 'draft',
  past: (e) => e.status === 'published' && e.isPast,
  cancelled: (e) => e.status === 'cancelled',
};

function StatusBadge({ event }: { event: OrganizedEvent }) {
  if (event.status === 'cancelled') return <Badge tone="danger">Cancelled</Badge>;
  if (event.status === 'draft') return <Badge>Draft</Badge>;
  if (event.isPast) return <Badge>Ended</Badge>;
  return <Badge tone="success">Live</Badge>;
}

export default function OrganizerConsole() {
  const { version, eventsChanged } = useEventsSync();
  const { openCreateEvent } = useCreateEvent();
  const [overview, setOverview] = useState<OrganizerOverview | null>(null);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [cancelling, setCancelling] = useState<OrganizedEvent | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleting, setDeleting] = useState<OrganizedEvent | null>(null);

  const load = useCallback(() => {
    organizerApi.overview().then(setOverview).catch((err) => toast.error(errorMessage(err)));
  }, []);
  useEffect(load, [load, version]);

  const counts = useMemo(
    () => Object.fromEntries((Object.keys(matches) as Filter[]).map((f) => [f, overview?.events.filter(matches[f]).length ?? 0])) as Record<Filter, number>,
    [overview]
  );
  const visible = overview?.events.filter(matches[filter]) ?? [];
  const stats = overview?.stats;

  async function confirmCancel() {
    if (!cancelling) return;
    try {
      await eventsApi.cancel(cancelling.id, cancelReason);
      toast.success('Event cancelled', { description: 'Everyone registered has been notified.' });
      eventsChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await eventsApi.remove(deleting.id);
      toast('Event deleted');
      eventsChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        kicker="Organizer console"
        title={<>Run the <em>show</em></>}
        description="Publish events, watch RSVPs roll in, check people in at the door."
        actions={
          <Button onClick={() => openCreateEvent()}>
            <Plus /> New event
          </Button>
        }
      />

      <Stagger className="mb-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Upcoming events', value: stats?.upcomingEvents, icon: <CalendarDays />, accent: true },
          { label: 'Registrations', value: stats?.totalRegistrations, icon: <Users /> },
          { label: 'On waitlists', value: stats?.waitlisted, icon: <Hourglass /> },
          {
            label: 'Attendance rate',
            value: stats ? (stats.attendanceRate == null ? '—' : `${stats.attendanceRate}%`) : undefined,
            icon: <TrendingUp />,
            hint: 'Checked in at finished events',
          },
        ].map((s) => (
          <StaggerItem key={s.label} className="h-full">
            <StatCard label={s.label} value={s.value ?? <span className="inline-block h-10 w-14 animate-pulse rounded-xl bg-surface-muted" />} icon={s.icon} hint={s.hint} accent={s.accent} />
          </StaggerItem>
        ))}
      </Stagger>

      <div className="mb-4 overflow-x-auto">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
            { value: 'drafts', label: 'Drafts', count: counts.drafts },
            { value: 'past', label: 'Past', count: counts.past },
            { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
          ]}
        />
      </div>

      {!overview ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          emoji="📣"
          title={filter === 'upcoming' ? 'No upcoming events' : `No ${filter} events`}
          description={filter === 'upcoming' ? 'Publish your first event and start collecting RSVPs.' : undefined}
          action={filter === 'upcoming' && <Button onClick={() => openCreateEvent()}><Plus /> New event</Button>}
        />
      ) : (
        <Stagger key={filter} className="space-y-3">
          {visible.map((event) => (
            <StaggerItem key={event.id}>
              <article className="group flex flex-col gap-4 rounded-[28px] border border-border bg-surface p-3 transition hover:border-border-strong sm:flex-row sm:items-center">
                <Link href={`/events/${event.id}`} className="block shrink-0">
                  <EventCover event={event} stickers={false} className="aspect-[16/10] w-full rounded-3xl sm:w-44" />
                </Link>
                <div className="min-w-0 flex-1 px-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge event={event} />
                    {event.capacity && event.attendeeCount >= event.capacity && <Badge tone="warning">Full</Badge>}
                  </div>
                  <Link href={`/events/${event.id}`} className="mt-1.5 block truncate font-display text-xl font-bold hover:text-primary">
                    {event.title}
                  </Link>
                  <p className="truncate text-sm text-muted">
                    {formatEventWhen(event)} · {formatVenue(event)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="flex items-center gap-1"><Users className="size-3.5" /> {event.stats.going}{event.capacity ? `/${event.capacity}` : ''} going</span>
                    <span className="flex items-center gap-1"><Hourglass className="size-3.5" /> {event.stats.waitlisted} waitlisted</span>
                    <span className="flex items-center gap-1"><CalendarCheck className="size-3.5" /> {event.stats.checkedIn} checked in</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 px-1">
                  <ButtonLink href={`/organizer/events/${event.id}`} variant="secondary" size="sm">
                    {event.viewer.canManage ? <><Users /> Attendees</> : <><ScanLine /> Door check-in</>}
                  </ButtonLink>
                  {event.viewer.canManage && event.status !== 'cancelled' && (
                    <Button variant="ghost" size="icon-sm" aria-label="Edit" title="Edit" onClick={() => openCreateEvent({ event })}>
                      <Pencil />
                    </Button>
                  )}
                  {event.viewer.canManage && event.status === 'published' && !event.isPast && (
                    <Button variant="ghost" size="icon-sm" aria-label="Cancel event" title="Cancel event" onClick={() => { setCancelReason(''); setCancelling(event); }}>
                      <Ban />
                    </Button>
                  )}
                  {/* Only the owner may delete (managers can cancel instead). */}
                  {event.viewer.isOwner && (
                    <Button variant="ghost" size="icon-sm" aria-label="Delete" title="Delete" onClick={() => setDeleting(event)} className="hover:text-danger">
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={confirmCancel}
        title={`Cancel “${cancelling?.title ?? ''}”?`}
        description={`${(cancelling?.stats.going ?? 0) + (cancelling?.stats.waitlisted ?? 0)} registered people will be notified by email and in the app.`}
        confirmLabel="Cancel event"
      >
        <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-medium">Message to attendees (optional)</label>
        <Textarea id="cancel-reason" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Rescheduling due to rain. New date coming soon." />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete “${deleting?.title ?? ''}”?`}
        description="This removes the event, its registrations and chat history. It can't be undone."
        confirmLabel="Delete permanently"
      />
    </>
  );
}
