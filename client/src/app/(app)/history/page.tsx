'use client';

/** "My events": everything you've been to, with ratings and certificates (Roadmap "Next" #5). */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Award, CheckCircle2 } from 'lucide-react';
import { meApi, type SyncEvent } from '@/lib/api';
import { formatEventWhen } from '@/lib/format';
import { ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/surface';
import EventCover from '@/components/events/EventCover';

export default function HistoryPage() {
  const [events, setEvents] = useState<SyncEvent[] | null>(null);

  useEffect(() => {
    meApi
      .registrations(false)
      .then((all) => setEvents(all.filter((e) => e.isPast && e.visibility === 'public' && e.status !== 'cancelled')))
      .catch(() => setEvents([]));
  }, []);

  const attended = events?.filter((e) => e.viewer.checkedIn).length ?? 0;

  return (
    <>
      <PageHeader
        kicker={events ? `${attended} attended` : 'Your history'}
        title={
          <>
            My <em>events</em>
          </>
        }
        description="Everything you've been to. Rate them, leave feedback and get your participation certificates."
      />
      {events === null ? (
        <div className="h-64 animate-pulse rounded-3xl bg-surface-muted" />
      ) : events.length === 0 ? (
        <EmptyState
          emoji="🗓️"
          title="Nothing yet"
          description="Events you go to will show up here afterwards."
          action={<ButtonLink href="/explore">Find something</ButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {events.map((e) => (
            <Card key={e.id} className="flex flex-col gap-4 p-3 sm:flex-row sm:items-center">
              <EventCover event={e} stickers={false} className="aspect-[16/10] w-full shrink-0 rounded-2xl sm:w-40" />
              <div className="min-w-0 flex-1 px-1">
                <Link href={`/events/${e.id}`} className="block truncate font-display text-lg font-bold hover:text-primary">
                  {e.title}
                </Link>
                <p className="text-sm text-muted">{formatEventWhen(e)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  {e.viewer.checkedIn ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-success" /> Attended
                    </>
                  ) : (
                    'Not checked in'
                  )}
                </p>
              </div>
              {e.viewer.checkedIn && (
                <div className="flex shrink-0 gap-2 px-1">
                  <ButtonLink href={`/events/${e.id}`} variant="secondary" size="sm">
                    Rate it
                  </ButtonLink>
                  <ButtonLink href={`/certificates/${e.id}`} variant="secondary" size="sm">
                    <Award /> Certificate
                  </ButtonLink>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
