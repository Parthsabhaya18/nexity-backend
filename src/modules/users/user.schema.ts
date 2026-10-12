import { z } from 'zod';

import { passwordSchema, usernameSchema } from '../auth/auth.schema';
import { BIO_MAX, MESSAGE_PRIVACY, WEBSITE_MAX } from './user.model';

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
  show_activity_status: z.boolean().optional(),
  message_privacy: z.enum(MESSAGE_PRIVACY).optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const notificationSettingsSchema = z
  .object({
    paused: z.boolean().optional(),
    comments: z.boolean().optional(),
    story_likes: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Choose a setting to change.',
  });

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;

export const changePasswordSchema = z.object({
  current_password: z
    .string({ error: 'Enter your current password.' })
    .min(1, 'Enter your current password.'),
  new_password: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
});

export const sessionIdSchema = z.object({ sessionId: z.uuid('Session not found.') });

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
