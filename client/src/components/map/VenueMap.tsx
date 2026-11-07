'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, LoaderCircle, MapPin, Navigation, Search } from 'lucide-react';
import { eventsApi, type VenueSummary } from '@/lib/api';
import { CATEGORY_LABELS, formatDay, formatTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { usePlaceSearch } from './usePlaceSearch';

export interface PickedLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface VenueMapProps {
  /** When set, the map works as a picker and offers "Use this location". */
  onPick?: (location: PickedLocation) => void;
  className?: string;
}

// Shown before anything is selected; the busiest venue replaces it once loaded.
/** Where the map opens before a venue is picked: the campus (NEXT_PUBLIC_CAMPUS_LATITUDE/LONGITUDE). */
const DEFAULT_CENTER = {
  latitude: Number(process.env.NEXT_PUBLIC_CAMPUS_LATITUDE) || 26.5123,
  longitude: Number(process.env.NEXT_PUBLIC_CAMPUS_LONGITUDE) || 80.2329,
};

function osmEmbedUrl(lat: number, lng: number) {
  const d = 0.008;
  const bbox = [lng - d, lat - d, lng + d, lat + d].join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

const toLocation = (v: VenueSummary): PickedLocation => ({
  name: v.name,
  address: v.address,
  latitude: v.latitude,
  longitude: v.longitude,
});

/** Map of venues used by upcoming events, plus place search (OpenStreetMap). */
export default function VenueMap({ onPick, className }: VenueMapProps) {
  const [venues, setVenues] = useState<VenueSummary[] | null>(null);
  const [selected, setSelected] = useState<PickedLocation | null>(null);
  const [query, setQuery] = useState('');
  const { results, searching, error, clear } = usePlaceSearch(query);

  useEffect(() => {
    eventsApi
      .venues()
      .then((list) => {
        setVenues(list);
        setSelected((current) => current ?? (list[0] ? toLocation(list[0]) : null));
      })
      .catch(() => setVenues([]));
  }, []);

  const center = selected ?? DEFAULT_CENTER;
  const eventsHere = useMemo(
    () => venues?.find((v) => selected && v.latitude === selected.latitude && v.longitude === selected.longitude)?.events ?? [],
    [venues, selected]
  );

  const choose = (location: PickedLocation) => {
    setSelected(location);
    setQuery('');
    clear();
  };

  const showResults = query.trim().length >= 3 && (results.length > 0 || searching || error);

  return (
    <div className={cn('grid gap-4 lg:grid-cols-[1fr_20rem]', className)}>
      <div className="relative min-h-[420px] overflow-hidden rounded-[32px] border border-border bg-surface-muted">
        <iframe
          title="Map"
          src={osmEmbedUrl(center.latitude, center.longitude)}
          className="map-frame absolute inset-0 size-full border-0"
        />

        <div className="absolute inset-x-3 top-3 z-10">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              placeholder="Search any place, e.g. “Outreach Auditorium Kanpur”"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search places"
              className="h-12 w-full rounded-full border border-border bg-surface/90 pl-11 pr-10 text-[15px] shadow-lifted outline-none backdrop-blur-md transition focus:border-primary focus:ring-4 focus:ring-ring/25"
            />
            {searching && <LoaderCircle className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          {showResults && (
            <ul className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-border bg-surface-raised p-1 shadow-lifted">
              {!searching && error && <li className="px-3 py-2 text-sm text-muted">{error}</li>}
              {results.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => choose(place)}
                    className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-surface-muted"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{place.name}</span>
                      <span className="block truncate text-xs text-muted">{place.address}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between gap-3 rounded-3xl border border-border bg-surface/90 p-3.5 shadow-lifted backdrop-blur-md sm:right-auto sm:max-w-sm">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <MapPin className="size-4 shrink-0 text-primary" />
                <span className="truncate">{selected.name}</span>
              </p>
              {selected.address && <p className="mt-0.5 truncate text-xs text-muted">{selected.address}</p>}
            </div>
            {onPick ? (
              <Button size="sm" onClick={() => onPick(selected)} className="shrink-0">
                <Check /> Use this
              </Button>
            ) : (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
              >
                <Navigation className="size-3.5" /> Directions
              </a>
            )}
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-[28px] border border-border bg-surface p-4">
          <h3 className="font-display text-lg font-extrabold">Venues with upcoming events</h3>
          <div className="mt-3 space-y-1.5">
            {venues === null &&
              Array.from({ length: 4 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-muted" />)}
            {venues?.length === 0 && <p className="text-sm text-muted">No upcoming events have a map location yet.</p>}
            {venues?.map((v) => {
              const active = selected?.latitude === v.latitude && selected?.longitude === v.longitude;
              return (
                <button
                  key={`${v.name}-${v.latitude}-${v.longitude}`}
                  type="button"
                  onClick={() => choose(toLocation(v))}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                    active ? 'border-transparent bg-primary text-primary-foreground' : 'border-transparent hover:bg-surface-muted'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg',
                      active ? 'bg-black/15' : 'bg-surface-muted text-muted'
                    )}
                  >
                    <MapPin className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{v.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
                      {v.events.length} upcoming event{v.events.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {eventsHere.length > 0 && !onPick && (
          <div className="rounded-[28px] border border-border bg-surface p-4">
            <h3 className="font-display text-lg font-extrabold">Happening here</h3>
            <ul className="mt-3 space-y-2">
              {eventsHere.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`} className="block rounded-xl px-3 py-2 transition hover:bg-surface-muted">
                    <span className="block text-sm font-medium">{e.title}</span>
                    <span className="text-xs text-muted">
                      {CATEGORY_LABELS[e.category]} · {formatDay(e.startsAt)}, {formatTime(e.startsAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
