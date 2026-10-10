export const MEDIA_PURPOSES = ['avatar', 'post', 'story', 'reel', 'message', 'support'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
/** Kinds a post, story or reel item can be. */
export const VISUAL_KINDS = ['image', 'video'] as const;

/** Allowed MIME types and the file extension used for the S3 key. */
export const CONTENT_TYPES: Record<string, { kind: MediaKind; ext: string }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/heic': { kind: 'image', ext: 'heic' },
  'image/heif': { kind: 'image', ext: 'heif' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  /** Voice notes: AAC in an MPEG-4 container (.m4a). */
  'audio/mp4': { kind: 'audio', ext: 'm4a' },
};

/** Some Android pickers report non-standard MIME types. */
const CONTENT_TYPE_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'video/mov': 'video/quicktime',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
};

export function normalizeContentType(value: string) {
  const base = value.split(';')[0]!.trim().toLowerCase();
  return CONTENT_TYPE_ALIASES[base] ?? base;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

type KindRule = {
  /** Largest file accepted, checked when the upload starts and again on the stored object. */
  maxBytes: number;
  /** Longest video allowed, matching Instagram; `null` means no limit. */
  maxDurationMs?: number | null;
};

const SECOND = 1000;
/** Longest post, reel, story or message video. Mirrored in the app's mediaRules.ts. */
export const VIDEO_MAX_MS = 120 * SECOND;
/** Device metadata rounds durations, so a 3:00 reel may report 3:00.4. */
export const DURATION_TOLERANCE_MS = SECOND;

export const IMAGE_MAX_BYTES = 10 * MB;
export const VIDEO_MAX_BYTES = 200 * MB;
/** Story photos share the video ceiling. */
export const STORY_IMAGE_MAX_BYTES = 200 * MB;
export const VOICE_MAX_BYTES = 10 * MB;
/** Contact us screenshots. */
export const SUPPORT_IMAGE_MAX_BYTES = 5 * MB;
/** Longest voice message, like Instagram. Mirrored in the app's mediaRules.ts. */
export const VOICE_MAX_MS = 60 * SECOND;

/**
 * Size and length limits per purpose.
 * Keep in sync with `frontend/src/features/media/mediaRules.ts` and MEDIA_STORAGE.md.
 */
const IMAGE: KindRule = { maxBytes: IMAGE_MAX_BYTES };
const video = (maxDurationMs: number | null): KindRule => ({
  maxBytes: VIDEO_MAX_BYTES,
  maxDurationMs,
});

export const MEDIA_RULES: Record<MediaPurpose, Partial<Record<MediaKind, KindRule>>> = {
  avatar: { image: IMAGE },
  /** Posts, reels, stories and chat videos all stop at two minutes. */
  post: { image: IMAGE, video: video(VIDEO_MAX_MS) },
  reel: { video: video(VIDEO_MAX_MS) },
  story: { image: { maxBytes: STORY_IMAGE_MAX_BYTES }, video: video(VIDEO_MAX_MS) },
  message: {
    image: IMAGE,
    video: video(VIDEO_MAX_MS),
    audio: { maxBytes: VOICE_MAX_BYTES, maxDurationMs: VOICE_MAX_MS },
  },
  support: { image: { maxBytes: SUPPORT_IMAGE_MAX_BYTES } },
};

/** Most files one post, story batch or message can hold (enforced where they are created). */
export const MAX_ITEMS: Record<MediaPurpose, number> = {
  avatar: 1,
  post: 20,
  reel: 1,
  story: 10,
  message: 10,
  support: 4,
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
  support: 'support',
};

export function formatBytes(bytes: number) {
  if (bytes >= GB) return `${Math.round(bytes / GB)} GB`;
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / 1024)} KB`;
}
