export const MEDIA_PURPOSES = ['avatar', 'post', 'story', 'reel', 'message'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Allowed MIME types and the file extension used for the S3 key. */
export const CONTENT_TYPES: Record<string, { kind: MediaKind; ext: string }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/heic': { kind: 'image', ext: 'heic' },
  'image/heif': { kind: 'image', ext: 'heif' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
};

/** Some Android pickers report non-standard MIME types. */
const CONTENT_TYPE_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'video/mov': 'video/quicktime',
};

export function normalizeContentType(value: string) {
  const base = value.split(';')[0]!.trim().toLowerCase();
  return CONTENT_TYPE_ALIASES[base] ?? base;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

type KindRule = {
  /** Safety ceiling; the app compresses first, so real files never reach it. */
  maxBytes: number;
  /** Longest video allowed, matching Instagram; `null` means no limit. */
  maxDurationMs?: number | null;
};

const SECOND = 1000;
/** Device metadata rounds durations, so a 3:00 reel may report 3:00.4. */
export const DURATION_TOLERANCE_MS = SECOND;

/**
 * Instagram's limits. S3 POST uploads cap at 5 GB.
 * Keep in sync with `frontend/src/features/media/mediaRules.ts` and MEDIA_STORAGE.md.
 */
const IMAGE: KindRule = { maxBytes: 50 * MB };
const video = (maxDurationMs: number | null): KindRule => ({ maxBytes: 4 * GB, maxDurationMs });

export const MEDIA_RULES: Record<MediaPurpose, Partial<Record<MediaKind, KindRule>>> = {
  avatar: { image: { maxBytes: 20 * MB } },
  /** Carousel videos; anything longer is shared as a reel. */
  post: { image: IMAGE, video: video(60 * SECOND) },
  reel: { video: video(3 * 60 * SECOND) },
  story: { image: IMAGE, video: video(60 * SECOND) },
  message: { image: IMAGE, video: video(null) },
};

/** Most files one post, story batch or message can hold (enforced where they are created). */
export const MAX_ITEMS: Record<MediaPurpose, number> = {
  avatar: 1,
  post: 20,
  reel: 1,
  story: 10,
  message: 10,
};

export function formatDuration(ms: number) {
  const total = Math.round(ms / SECOND);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (total <= 60) return `${total} seconds`;
  if (!sec) return `${min} minute${min === 1 ? '' : 's'}`;
  return `${min}:${String(sec).padStart(2, '0')} minutes`;
}

/** Larger files go up in parts, so a dropped connection only re-sends one part. */
export const MULTIPART_THRESHOLD = 32 * MB;
/** S3 needs at least 5 MB per part (except the last) and at most 10,000 parts. */
const MIN_PART_SIZE = 8 * MB;
const MAX_PARTS = 10_000;

export function partSizeFor(bytes: number) {
  return Math.max(MIN_PART_SIZE, Math.ceil(bytes / MAX_PARTS / MB) * MB);
}

export const KEY_FOLDERS: Record<MediaPurpose, string> = {
  avatar: 'avatars',
  post: 'posts',
  story: 'stories',
  reel: 'reels',
  message: 'messages',
};

export function formatBytes(bytes: number) {
  if (bytes >= GB) return `${Math.round(bytes / GB)} GB`;
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / 1024)} KB`;
}
