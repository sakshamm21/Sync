/**
 * Place search for venues, backed by OpenStreetMap Nominatim (free, no key).
 * Requests go through the API so we can send the identifying User-Agent and
 * cache results, as the Nominatim usage policy asks.
 */
import env from '../../config/env';
import logger from '../../lib/logger';
import { AppError } from '../../lib/errors';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const CACHE_LIMIT = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Place {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

/** The fields we use from a Nominatim `jsonv2` search result. */
interface NominatimResult {
  place_id: number;
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
}

const cache = new Map<string, { places: Place[]; expires: number }>();

function fromCache(key: string): Place[] | null {
  const hit = cache.get(key);
  if (!hit || hit.expires < Date.now()) return null;
  return hit.places;
}

function remember(key: string, places: Place[]): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { places, expires: Date.now() + CACHE_TTL_MS });
}

const unavailable = () =>
  new AppError(503, 'Place search is unavailable right now. You can still type the venue name.', 'PLACES_UNAVAILABLE');

export async function search(query: string, { limit = 5 }: { limit?: number } = {}): Promise<Place[]> {
  const key = `${query.toLowerCase()}|${limit}`;
  const cached = fromCache(key);
  if (cached) return cached;

  const url = `${ENDPOINT}?${new URLSearchParams({ q: query, format: 'jsonv2', limit: String(limit) })}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': `Sync/2.0 (${env.clientUrl})`, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Place search unavailable');
    throw unavailable();
  }
  if (!response.ok) throw unavailable();

  const results = (await response.json()) as NominatimResult[];
  const places = results.map((r) => ({
    id: String(r.place_id),
    name: r.name || r.display_name.split(',')[0],
    address: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
  }));
  remember(key, places);
  return places;
}
