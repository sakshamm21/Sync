'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Calendar, { CALENDAR_LEGEND } from '@/components/calendar/ScheduleCalendar';
import { useCreateEvent } from '@/components/events/CreateEventDialog';
import { useEventsSync } from '@/context/EventContext';
import EntryCodes from '@/components/events/EntryCodes';
import { meApi, type SyncEvent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/surface';

export default function SchedulePage() {
  const { openCreateEvent } = useCreateEvent();
  const { version } = useEventsSync();
  const [mine, setMine] = useState<SyncEvent[]>([]);

  // Refetch after any RSVP elsewhere, so the entry code matches what you're going to.
  useEffect(() => {
    meApi
      .registrations(true)
      .then(setMine)
      .catch(() => setMine([]));
  }, [version]);

  return (
    <>
      <PageHeader
        kicker="Your month at a glance"
        title={
          <>
            My <em>schedule</em>
          </>
        }
        description="Everything you're going to, running, or planning. Tap a day to add something."
        actions={
          <Button onClick={() => openCreateEvent()}>
            <Plus /> Add event
          </Button>
        }
      />
      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
          {CALENDAR_LEGEND.map((item) => (
            <span key={item.key} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="size-2.5 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
        <Calendar onSelectDate={(date) => openCreateEvent({ date })} />
      </Card>

      <div className="mt-10">
        <EntryCodes events={mine} />
      </div>
    </>
  );
}
