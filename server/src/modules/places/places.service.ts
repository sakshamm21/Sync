/**
 * Place search for venues, backed by OpenStreetMap Nominatim (free, no key).
 * Requests go through the API so we can send the identifying User-Agent and
 * cache results, as the Nominatim usage policy asks.
 */
import mongoose from 'mongoose';
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

/** Nominatim allows one request a second from the whole app, not per instance. */
const MIN_GAP_MS = 1100;

/**
 * Waits for this request's turn. The next free slot is reserved atomically in
 * MongoDB, so every API instance (serverless runs many) shares one queue.
 * Without a database (unit tests) it only spaces requests in this process.
 */
let localNext = 0;
async function waitForTurn(): Promise<void> {
  const now = Date.now();
  let slot: number;
  const db = mongoose.connection.db;
  if (db && mongoose.connection.readyState === 1) {
    const row = await db.collection<{ _id: string; next: Date }>('job_locks').findOneAndUpdate(
      { _id: 'nominatim' },
      [{ $set: { next: { $add: [{ $max: [{ $ifNull: ['$next', new Date(now)] }, new Date(now)] }, MIN_GAP_MS] } } }],
      { upsert: true, returnDocument: 'after' }
    );
    slot = (row?.next?.getTime() ?? now + MIN_GAP_MS) - MIN_GAP_MS;
  } else {
    slot = Math.max(localNext, now);
    localNext = slot + MIN_GAP_MS;
  }
  const wait = slot - now;
  if (wait > 4000) throw new AppError(429, 'Place search is busy. Try again in a moment.', 'PLACES_BUSY');
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Prefer results within roughly 50 km of campus (a bias, not a limit). */
function campusViewbox(): string {
  const { latitude, longitude } = env.campus;
  const d = 0.5;
  return [longitude - d, latitude + d, longitude + d, latitude - d].join(',');
}

const unavailable = () =>
  new AppError(503, 'Place search is unavailable right now. You can still type the venue name.', 'PLACES_UNAVAILABLE');

export async function search(query: string, { limit = 5 }: { limit?: number } = {}): Promise<Place[]> {
  const key = `${query.toLowerCase()}|${limit}`;
  const cached = fromCache(key);
  if (cached) return cached;

  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(limit), viewbox: campusViewbox() });
  if (env.campus.countryCodes) params.set('countrycodes', env.campus.countryCodes);
  const url = `${ENDPOINT}?${params}`;
  await waitForTurn();
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
