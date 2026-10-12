import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/** A real-world place from OpenStreetMap, e.g. a village, area or landmark. */
export type LookedUpPlace = {
  name: string;
  area: string;
  latitude: number;
  longitude: number;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

/** Photon: OpenStreetMap search made for typing, free and keyless. */
const PHOTON_URL = 'https://photon.komoot.io/api/';
const TIMEOUT_MS = 4000;
const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; places: LookedUpPlace[] }>();

function areaOf(props: Record<string, string | undefined>, name: string) {
  const parts = [props.city ?? props.district ?? props.county, props.state, props.country];
  const seen = new Set([name.toLowerCase()]);
  const area: string[] = [];
  for (const part of parts) {
    if (!part || seen.has(part.toLowerCase())) continue;
    seen.add(part.toLowerCase());
    area.push(part);
  }
  return area.join(', ');
}

export function toPlaces(features: PhotonFeature[]): LookedUpPlace[] {
  const seen = new Set<string>();
  const places: LookedUpPlace[] = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const [lng, lat] = feature.geometry?.coordinates ?? [];
    const name = props.name?.trim();
    if (!name || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const area = areaOf(props, name);
    const key = `${name}|${area}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ name, area, latitude: lat, longitude: lng });
  }
  return places;
}

/**
 * Searches real places by name. Returns `[]` when the service is slow or down,
 * so the location sheet still works with suggested and typed places.
 */
export async function lookUpPlaces(rawQuery: string, limit: number): Promise<LookedUpPlace[]> {
  const term = rawQuery.trim().toLowerCase();
  if (term.length < 2 || env.NODE_ENV === 'test') return [];
  const key = `${term}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const url = `${PHOTON_URL}?${new URLSearchParams({ q: term, limit: String(limit), lang: 'en' })}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Nexity/1.0 (location search)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { features?: PhotonFeature[] };
    const places = toPlaces(body.features ?? []).slice(0, limit);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), places });
    return places;
  } catch (err) {
    logger.warn({ err }, 'place lookup failed');
    return [];
  }
}
