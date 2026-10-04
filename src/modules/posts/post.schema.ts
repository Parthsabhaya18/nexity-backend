import { z } from 'zod';

import { objectIdSchema } from '../follows/follow.schema';
import { MEDIA_LOOKS } from '../media/media.looks';
import { MAX_ITEMS } from '../media/media.rules';
import { CAPTION_MAX } from './caption';
import { ALT_TEXT_MAX, LOCATION_MAX, MAX_ASPECT, MIN_ASPECT, MUSIC_MAX } from './post.model';

const look = z.number().min(-100).max(100);
/** Photo edits stored with the post and replayed for every viewer. */
export const adjustmentsSchema = z
  .object({
    brightness: look.default(0),
    contrast: look.default(0),
    saturation: look.default(0),
    warmth: look.default(0),
    fade: z.number().min(0).max(100).default(0),
    sharpen: z.number().min(0).max(100).default(0),
    blur: z.number().min(0).max(100).default(0),
    vignette: z.number().min(0).max(100).default(0),
  })
  .optional();

export const ZERO_ADJUSTMENTS = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  fade: 0,
  sharpen: 0,
  blur: 0,
  vignette: 0,
};

export const createPostSchema = z.object({
  media_ids: z
    .array(objectIdSchema)
    .min(1, 'Add at least one photo.')
    .max(MAX_ITEMS.post, `A post can have up to ${MAX_ITEMS.post} photos or videos.`)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: 'Each photo can only be added once.',
    }),
  caption: z
    .string()
    .max(CAPTION_MAX, `Captions can be up to ${CAPTION_MAX} characters.`)
    .default('')
    .transform((s) => s.trim()),
  alt_texts: z.array(z.string().trim().max(ALT_TEXT_MAX)).max(MAX_ITEMS.post).default([]),
  location_name: z.string().trim().max(LOCATION_MAX).default(''),
  location_lat: z.number().min(-90).max(90).nullable().optional(),
  location_lng: z.number().min(-180).max(180).nullable().optional(),
  adjustments: adjustmentsSchema,
  /** One look per photo, in carousel order. Missing entries stay `normal`. */
  filters: z.array(z.enum(MEDIA_LOOKS)).max(MAX_ITEMS.post).optional(),
  music_title: z.string().trim().max(MUSIC_MAX).default(''),
  aspect_ratio: z.number().min(MIN_ASPECT).max(MAX_ASPECT).default(1),
  hide_like_count: z.boolean().default(false),
  comments_disabled: z.boolean().default(false),
  client_upload_id: z
    .string()
    .regex(/^[\w-]{8,64}$/, 'Invalid upload id')
    .optional(),
});

export const postIdParamsSchema = z.object({ postId: objectIdSchema });

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z
  .object({
    caption: z.string().max(CAPTION_MAX).transform((s) => s.trim()).optional(),
    location_name: z.string().trim().max(LOCATION_MAX).optional(),
    alt_texts: z.array(z.string().trim().max(ALT_TEXT_MAX)).max(MAX_ITEMS.post).optional(),
    hide_like_count: z.boolean().optional(),
    comments_disabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export const commentBodySchema = z.object({
  body: z.string().trim().min(1, 'Write a comment.').max(1000, 'Use at most 1000 characters.'),
  parent_id: objectIdSchema.optional(),
});

export const cursorQuerySchema = z.object({
  cursor: objectIdSchema.optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(50).default(20).catch(20),
});

export const tagParamsSchema = z.object({
  tag: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[\p{L}\p{M}\p{N}_]{1,100}$/u, 'Invalid hashtag'),
});
