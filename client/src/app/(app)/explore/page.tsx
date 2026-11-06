'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { useEventsSync } from '@/context/EventContext';
import { errorMessage, eventsApi, type CategoryValue, type EventQuery, type SyncEvent } from '@/lib/api';
import { CATEGORIES, CATEGORY_EMOJI, CATEGORY_LABELS, campusDateKey } from '@/lib/format';
import { DATE_PRESET_LABELS, rangeFor, type DatePreset } from '@/lib/dateRanges';
import { toast } from 'sonner';
import EventCard, { EventCardSkeleton } from '@/components/events/EventCard';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/surface';
import { FilterChips, Segmented } from '@/components/ui/tabs';
import { FormAlert } from '@/components/ui/field';
import { Stagger, StaggerItem } from '@/components/ui/motion';

const PAGE_SIZE = 12;
type Sort = NonNullable<EventQuery['sort']>;
const SORTS: Sort[] = ['soonest', 'popular', 'newest'];
const PRESETS = Object.keys(DATE_PRESET_LABELS) as DatePreset[];
/** A preset name or a picked day (YYYY-MM-DD). */
type When = DatePreset | string;
const isWhen = (v: string | null): v is When => !!v && (PRESETS.includes(v as DatePreset) || /^\d{4}-\d{2}-\d{2}$/.test(v));

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function Explore() {
  const params = useSearchParams();
  const router = useRouter();
  const { version } = useEventsSync();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState<CategoryValue | null>(() => {
    const c = params.get('category') as CategoryValue | null;
    return c && CATEGORIES.includes(c) ? c : null;
  });
  const [sort, setSort] = useState<Sort>(() => {
    const s = params.get('sort') as Sort | null;
    return s && SORTS.includes(s) ? s : 'soonest';
  });
  const [when, setWhen] = useState<When | null>(() => (isWhen(params.get('when')) ? params.get('when') : null));
  // Bumped whenever the filters change, so a slow "Load more" for old filters is dropped.
  const generation = useRef(0);
  const [events, setEvents] = useState<SyncEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(search.trim());

  // The top bar search navigates here with ?q=…
  const urlQ = params.get('q') ?? '';
  useEffect(() => {
    setSearch(urlQ);
  }, [urlQ]);

  // Keep every filter in the URL so a filtered view can be shared.
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (category) next.set('category', category);
    if (when) next.set('when', when);
    if (sort !== 'soonest') next.set('sort', sort);
    const qs = next.toString();
    if (qs !== params.toString()) router.replace(qs ? `/explore?${qs}` : '/explore', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, when, sort]);

  const query = (pageNumber: number): EventQuery => ({
    q: q || undefined,
    category: category ?? undefined,
    ...(when ? rangeFor(when) : {}),
    sort,
    page: pageNumber,
    limit: PAGE_SIZE,
  });

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    eventsApi
      .list(query(1))
      .then(({ items, meta }) => {
        if (cancelled) return;
        setEvents(items);
        setTotal(meta.total);
        setPage(1);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, when, sort, version]);

  async function loadMore() {
    const started = generation.current;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const { items } = await eventsApi.list(query(next));
      if (started !== generation.current) return; // The filters changed meanwhile.
      // Skip anything already shown (a new event can shift the pages).
      setEvents((prev) => {
        const seen = new Set((prev ?? []).map((e) => e.id));
        return [...(prev ?? []), ...items.filter((e) => !seen.has(e.id))];
      });
      setPage(next);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = Boolean(q || category || when);

  const replace = (updated: SyncEvent) => setEvents((prev) => prev?.map((e) => (e.id === updated.id ? updated : e)) ?? prev);

  return (
    <>
      <PageHeader
        kicker="Everything coming up on campus"
        title={
          <>
            Explore the <em>good stuff</em>
          </>
        }
        description="Search it, filter it, tap I’m in. That’s it."
      />

      <div className="mb-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-primary" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="hackathon, open mic, football…"
              aria-label="Search events"
              className="h-14 w-full rounded-full border border-border bg-surface pl-12 pr-4 font-display text-lg font-semibold outline-none transition placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-subtle hover:border-border-strong focus:border-primary focus:ring-4 focus:ring-ring/25"
            />
          </div>
          <Segmented<Sort>
            value={sort}
            onChange={setSort}
            options={[
              { value: 'soonest', label: 'Soonest' },
              { value: 'popular', label: 'Trending 🔥' },
              { value: 'newest', label: 'New' },
            ]}
          />
        </div>
        <FilterChips<CategoryValue>
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c], emoji: CATEGORY_EMOJI[c] }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips<DatePreset>
            value={when && PRESETS.includes(when as DatePreset) ? (when as DatePreset) : null}
            onChange={(v) => setWhen(v)}
            allLabel="Any day"
            options={PRESETS.map((p) => ({ value: p, label: DATE_PRESET_LABELS[p] }))}
          />
          <label className="flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-muted">
            <span>Pick a date</span>
            <input
              type="date"
              value={when && !PRESETS.includes(when as DatePreset) ? when : ''}
              min={campusDateKey(new Date())}
              onChange={(e) => setWhen(e.target.value || null)}
              aria-label="Pick a date"
              className="bg-transparent text-foreground outline-none"
            />
          </label>
        </div>
      </div>

      <FormAlert message={error} />

      {events === null ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          emoji="🔍"
          title="Nothing matches… yet"
          description={filtered ? 'Try a different search, category or day.' : 'Nothing is scheduled yet. Check back soon.'}
          action={
            filtered && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setCategory(null);
                  setWhen(null);
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <>
          <p className="mb-6 font-mono text-xs uppercase tracking-[0.16em] text-muted">
            {total} event{total === 1 ? '' : 's'}
          </p>
          <Stagger key={`${q}-${category}-${when}-${sort}`} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <StaggerItem key={event.id}>
                <EventCard event={event} onChange={replace} />
              </StaggerItem>
            ))}
          </Stagger>
          {events.length < total && (
            <div className="mt-8 flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <Explore />
    </Suspense>
  );
}
