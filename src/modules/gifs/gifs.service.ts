import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';

const GIPHY_BASE = 'https://api.giphy.com/v1';

export const GIF_KINDS = ['gif', 'sticker'] as const;
export type GifKind = (typeof GIF_KINDS)[number];
const TRENDING_TTL_MS = 10 * 60_000;
const TRENDING_CACHE_MAX = 50;
const REQUEST_TIMEOUT_MS = 5_000;

export interface GifDto {
  id: string;
  title: string;
  /** Animated rendition sent in messages (fixed width ~200px, small enough for chat). */
  url: string;
  /** Lighter rendition for the picker grid. */
  preview_url: string;
  width: number;
  height: number;
}

export interface GifPage {
  data: GifDto[];
  pagination: { next_cursor: string | null; has_more: boolean };
}

interface GiphyRendition {
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyGif {
  id: string;
  title?: string;
  images?: Record<string, GiphyRendition | undefined>;
}

interface GiphyResponse {
  data: GiphyGif[];
  pagination?: { total_count?: number; count?: number; offset?: number };
}

const trendingCache = new Map<string, { expires: number; page: GifPage }>();

function normalize(gif: GiphyGif): GifDto | null {
  const full = gif.images?.fixed_width;
  const preview = gif.images?.fixed_width_downsampled ?? full;
  if (!full?.url || !preview?.url) return null;
  // Strip tracking query params so the stored URL matches the allow-list pattern.
  const clean = (u: string) => u.split('?')[0]!;
  return {
    id: gif.id,
    title: gif.title ?? '',
    url: clean(full.url),
    preview_url: clean(preview.url),
    width: Number(full.width) || 200,
    height: Number(full.height) || 200,
  };
}

async function callGiphy(
  kind: GifKind,
  path: string,
  params: Record<string, string>,
): Promise<GifPage> {
  if (!env.GIPHY_API_KEY) {
    throw new ApiError(503, 'GIFs are not available right now.', undefined, 'GIFS_NOT_CONFIGURED');
  }
  const query = new URLSearchParams({
    api_key: env.GIPHY_API_KEY,
    rating: env.GIPHY_RATING,
    bundle: 'messaging_non_clips',
    ...params,
  });

  let body: GiphyResponse;
  try {
    const res = await fetch(`${GIPHY_BASE}/${kind}s/${path}?${query}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GIPHY responded ${res.status}`);
    body = (await res.json()) as GiphyResponse;
  } catch (err) {
    logger.warn({ err }, 'GIPHY request failed');
    throw new ApiError(502, 'Could not load GIFs. Try again.', undefined, 'GIFS_UNAVAILABLE');
  }

  const offset = body.pagination?.offset ?? Number(params.offset ?? 0);
  const count = body.pagination?.count ?? body.data.length;
  const total = body.pagination?.total_count ?? 0;
  const next = offset + count;
  const hasMore = count > 0 && next < total;
  return {
    data: body.data.map(normalize).filter((g): g is GifDto => g !== null),
    pagination: { next_cursor: hasMore ? String(next) : null, has_more: hasMore },
  };
}

export async function trending(limit: number, offset: number, kind: GifKind = 'gif') {
  const key = `${kind}:${offset}:${limit}`;
  const cached = trendingCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.page;
  const page = await callGiphy(kind, 'trending', {
    limit: String(limit),
    offset: String(offset),
  });
  if (trendingCache.size >= TRENDING_CACHE_MAX) {
    const oldest = trendingCache.keys().next().value;
    if (oldest !== undefined) trendingCache.delete(oldest);
  }
  trendingCache.set(key, { expires: Date.now() + TRENDING_TTL_MS, page });
  return page;
}

/** Test hook: forget cached trending pages. */
export function clearGifCache() {
  trendingCache.clear();
}

export function search(q: string, limit: number, offset: number, kind: GifKind = 'gif') {
  return callGiphy(kind, 'search', {
    q,
    limit: String(limit),
    offset: String(offset),
    lang: 'en',
  });
}
