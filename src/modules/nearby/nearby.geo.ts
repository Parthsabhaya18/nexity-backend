const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export const CELL_PRECISION = 7;
/** Size of a geohash-7 cell in degrees (17 latitude bits, 18 longitude bits). */
const CELL_LAT_DEG = 180 / 2 ** 17;
const CELL_LNG_DEG = 360 / 2 ** 18;
const EARTH_RADIUS_M = 6_371_000;

export function geohash(lat: number, lng: number, precision = CELL_PRECISION) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** The point's cell and its 8 neighbours. */
export function cellsAround(lat: number, lng: number) {
  const cells = new Set<string>();
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      cells.add(geohash(clampLat(lat + dy * CELL_LAT_DEG), wrapLng(lng + dx * CELL_LNG_DEG)));
    }
  }
  return [...cells];
}

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** ~11 m: enough for proximity, no more precise than needed. */
export const roundCoord = (v: number) => Math.round(v * 10_000) / 10_000;
