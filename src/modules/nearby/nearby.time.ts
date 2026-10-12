const DAY_MS = 86_400_000;
const SKEW_MS = 5 * 60_000;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const partFormatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const safeTz = (tz: string | null | undefined) =>
  tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;

/** `YYYY-MM-DD` of `d` in `tz`. */
export function dayKey(d: Date, tz: string | null | undefined) {
  const zone = safeTz(tz);
  let f = dayFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    dayFormatters.set(zone, f);
  }
  return f.format(d);
}

/** Milliseconds `tz` is ahead of UTC at instant `d`. */
function offsetMs(d: Date, tz: string) {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The first instant of the local day after `d`'s local day. */
export function nextLocalMidnight(d: Date, tz: string | null | undefined) {
  const zone = safeTz(tz);
  const [y, m, day] = dayKey(d, zone).split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, day + 1);
  let at = guess - offsetMs(new Date(guess), zone);
  // Re-check once in case the offset changed across the DST boundary.
  at = guess - offsetMs(new Date(at), zone);
  return new Date(at);
}

/** Start of the local day containing `d`. */
export function localDayStart(d: Date, tz: string | null | undefined) {
  const next = nextLocalMidnight(d, tz);
  return nextLocalMidnight(new Date(next.getTime() - DAY_MS - 3 * 3_600_000), tz);
}

export type HintDay = 'today' | 'yesterday';

/** Calendar days in the viewer's zone: same day → today, previous day → yesterday, older → nothing. */
export function hintState(
  lastDetectedAt: Date,
  expiresAt: Date,
  now: Date,
  tz: string | null | undefined,
): HintDay | null {
  if (Number.isNaN(lastDetectedAt.getTime()) || expiresAt <= now) return null;
  if (lastDetectedAt.getTime() > now.getTime() + SKEW_MS) return null;
  const diff = (Date.parse(dayKey(now, tz)) - Date.parse(dayKey(lastDetectedAt, tz))) / DAY_MS;
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return null;
}
