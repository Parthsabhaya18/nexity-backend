import { z } from 'zod';

import { MESSAGE_MAX_LENGTH } from './message.model';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id.');

const limitSchema = z.coerce.number().int().min(1).max(50).default(20);

export const idParamSchema = z.object({ id: objectIdSchema });

export const listConversationsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: limitSchema,
});

export const createConversationSchema = z.object({
  type: z.literal('direct').default('direct'),
  participant_ids: z
    .array(objectIdSchema, { error: 'Pick someone to message.' })
    .length(1, 'Pick one person to message.'),
});

export const listMessagesQuerySchema = z.object({
  /** Older page: messages before this id (newest first). */
  cursor: objectIdSchema.optional(),
  /** Catch-up after reconnect: messages after this id (oldest first). */
  after: objectIdSchema.optional(),
  limit: limitSchema,
});

/** Only GIPHY's own CDN is accepted, so a client can't make the app load arbitrary URLs. */
const giphyUrlSchema = z
  .string()
  .max(500)
  .regex(/^https:\/\/(media\d*|i)\.giphy\.com\/[\w\-./?=&%]+$/, 'Invalid GIF.');

export const gifSchema = z.object({
  id: z.string().trim().min(1).max(64),
  url: giphyUrlSchema,
  preview_url: giphyUrlSchema.nullable().optional(),
  width: z.coerce.number().int().min(1).max(4000),
  height: z.coerce.number().int().min(1).max(4000),
  /** Stickers are transparent GIPHY stickers, shown without a bubble. */
  kind: z.enum(['gif', 'sticker']).default('gif'),
});

export const sendMessageSchema = z
  .object({
    body: z
      .string()
      .trim()
      .max(MESSAGE_MAX_LENGTH, `Messages can be at most ${MESSAGE_MAX_LENGTH} characters.`)
      .default(''),
    media_id: objectIdSchema.nullable().optional(),
    gif: gifSchema.nullable().optional(),
    reply_to_id: objectIdSchema.nullable().optional(),
    client_message_id: z.uuid({ error: 'client_message_id must be a UUID.' }),
  })
  .refine((v) => v.body.length > 0 || v.media_id || v.gif, {
    path: ['body'],
    message: 'Type a message.',
  });

export const markReadSchema = z.object({ message_id: objectIdSchema.optional() });

export const messageParamsSchema = z.object({
  id: objectIdSchema,
  messageId: objectIdSchema,
});

export const muteSchema = z.object({ muted: z.boolean() });

export const reactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1, 'Pick an emoji.')
    .max(32, 'Pick an emoji.')
    .regex(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u, 'Pick an emoji.'),
});

export const editMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Type a message.')
    .max(MESSAGE_MAX_LENGTH, `Messages can be at most ${MESSAGE_MAX_LENGTH} characters.`),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
