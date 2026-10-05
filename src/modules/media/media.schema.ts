import { z } from 'zod';

import { CONTENT_TYPES, MEDIA_PURPOSES, normalizeContentType } from './media.rules';

/** Optional metadata: a bad value from a device is dropped rather than failing the upload. */
const dimension = z.number().int().positive().max(20_000).optional().catch(undefined);

export const createUploadSchema = z.object({
  purpose: z.enum(MEDIA_PURPOSES, { error: 'Choose what this file is for.' }),
  content_type: z
    .string({ error: 'File type is required.' })
    .transform(normalizeContentType)
    .refine((v) => v in CONTENT_TYPES, {
      message: 'This file type is not supported. Use JPG, PNG, WEBP, HEIC, MP4 or MOV.',
    }),
  bytes: z.number({ error: 'File size is required.' }).int().positive(),
  width: dimension,
  height: dimension,
  duration_ms: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60 * 1000)
    .optional()
    .catch(undefined),
  /** Generated on the device per file; sending it again (retry, app restart) returns the same upload. */
  client_upload_id: z
    .string()
    .regex(/^[\w-]{8,64}$/, 'Invalid client_upload_id')
    .optional(),
});

export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export const partUrlsSchema = z.object({
  part_numbers: z
    .array(z.number().int().min(1).max(10_000))
    .min(1)
    .max(100)
    .transform((list) => [...new Set(list)]),
});

export const mediaIdSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid media id'),
});
