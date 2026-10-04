import { z } from 'zod';

import { usernameSchema } from '../auth/auth.schema';
import { BIO_MAX, WEBSITE_MAX } from './user.model';

const websiteSchema = z
  .string()
  .trim()
  .max(WEBSITE_MAX, `Use at most ${WEBSITE_MAX} characters.`)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => {
    if (!v) return true;
    try {
      const url = new URL(v);
      return /^https?:$/.test(url.protocol) && /^[^.\s]+(\.[^.\s]+)+$/.test(url.hostname);
    } catch {
      return false;
    }
  }, 'Enter a valid website, like example.com.');

/** Every field is optional; only the ones sent are changed. `avatar_media_id: null` removes the photo. */
export const updateMeSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, 'Please enter your name.')
    .max(50, 'Use at most 50 characters.')
    .optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(BIO_MAX, `Use at most ${BIO_MAX} characters.`).optional(),
  website: websiteSchema.optional(),
  avatar_media_id: z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'Upload the photo again.')
    .nullable()
    .optional(),
  is_private: z.boolean().optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const MOODS = [
  'happy',
  'calm',
  'romantic',
  'sad',
  'angry',
  'cool',
  'relaxed',
  'excited',
  'tired',
  'motivated',
] as const;

export const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    mood: z.enum(MOODS).nullable().optional(),
  })
  .refine((v) => v.theme !== undefined || v.mood !== undefined, {
    message: 'Choose a theme or a mood.',
  });

export type PreferencesInput = z.infer<typeof preferencesSchema>;
