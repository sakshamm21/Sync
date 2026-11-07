'use client';

import { useEffect, useState } from 'react';
import { errorMessage, placesApi, type Place } from '@/lib/api';

/** Debounced place lookup; returns nothing until the query has 3+ characters. */
export function usePlaceSearch(query: string) {
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      placesApi
        .search(q)
        .then((places) => {
          if (cancelled) return;
          setResults(places);
          setError(places.length ? null : 'No places found. Try adding the city.');
        })
        .catch((err) => !cancelled && setError(errorMessage(err)))
        .finally(() => !cancelled && setSearching(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // A cancelled request never reaches its finally, so don't stay "Searching…".
      setSearching(false);
    };
  }, [query]);

  const clear = () => setResults([]);
  return { results, searching, error, clear };
}
