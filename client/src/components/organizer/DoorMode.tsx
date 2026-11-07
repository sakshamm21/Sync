'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Circle, Search } from 'lucide-react';
import { errorMessage, eventsApi, type DoorList, type SyncEvent } from '@/lib/api';
import DoorScanner from '@/components/organizer/DoorScanner';
import { Avatar, Card } from '@/components/ui/surface';
import { cn } from '@/lib/cn';

/**
 * Check-in for the door: the scanner, a live count, and a name search for
 * people whose phone died. Uses the door list, which has no email addresses,
 * so check-in-only staff can use it too.
 */
export default function DoorMode({ event, version }: { event: SyncEvent; version?: number }) {
  const [list, setList] = useState<DoorList | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    eventsApi
      .doorList(event.id)
      .then(setList)
      .catch((err) => toast.error(errorMessage(err)));
  }, [event.id]);
  useEffect(load, [load, version]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!list) return [];
    return q ? list.items.filter((i) => i.user.name.toLowerCase().includes(q)) : list.items;
  }, [list, search]);

  async function toggle(item: DoorList['items'][number]) {
    const checkedIn = !item.checkedInAt;
    setList(
      (prev) =>
        prev && {
          items: prev.items.map((i) => (i.id === item.id ? { ...i, checkedInAt: checkedIn ? new Date().toISOString() : null } : i)),
          counts: { ...prev.counts, checkedIn: prev.counts.checkedIn + (checkedIn ? 1 : -1) },
        }
    );
    try {
      await eventsApi.setCheckIn(event.id, item.user.id, checkedIn);
    } catch (err) {
      toast.error(errorMessage(err));
      load();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[26rem_1fr]">
      <Card className="space-y-4 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Door check-in</h2>
          {list && (
            <p className="text-sm tabular-nums text-muted" aria-live="polite">
              <span className="text-2xl font-semibold text-foreground">{list.counts.checkedIn}</span> / {list.counts.going} checked in
            </p>
          )}
        </div>
        <p className="text-xs text-muted">Attendees show the code on their event page. Scanning one checks them in.</p>
        <DoorScanner event={event} onScanned={load} />
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="mb-3 font-semibold">Check in by name</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              placeholder="Find someone going"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search people going"
              className="h-10 w-full rounded-xl border border-border bg-surface-muted pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-surface focus:ring-4 focus:ring-ring/20"
            />
          </div>
        </div>
        {!list ? (
          <div className="m-4 h-40 animate-pulse rounded-2xl bg-surface-muted" />
        ) : visible.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted">{list.items.length ? 'No one matches.' : 'Nobody is going yet.'}</p>
        ) : (
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
            {visible.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={item.user.name} src={item.user.avatarUrl} size={36} />
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.user.name}</p>
                <button
                  onClick={() => toggle(item)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    item.checkedInAt ? 'border-transparent bg-success-soft text-success' : 'border-border text-muted hover:border-border-strong hover:text-foreground'
                  )}
                >
                  {item.checkedInAt ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                  {item.checkedInAt ? 'Checked in' : 'Check in'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
