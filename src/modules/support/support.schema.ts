import { z } from 'zod';

import { objectIdSchema } from '../follows/follow.schema';
import { MAX_ITEMS } from '../media/media.rules';
import { SUPPORT_MESSAGE_MAX, SUPPORT_MESSAGE_MIN, SUPPORT_SUBJECTS } from './supportTicket.model';

export const createTicketSchema = z.object({
  subject: z.enum(SUPPORT_SUBJECTS, { error: 'Choose a topic.' }),
  message: z
    .string({ error: 'Describe the issue.' })
    .trim()
    .min(SUPPORT_MESSAGE_MIN, `Tell us a little more (at least ${SUPPORT_MESSAGE_MIN} characters).`)
    .max(SUPPORT_MESSAGE_MAX, `Use at most ${SUPPORT_MESSAGE_MAX} characters.`),
  screenshot_media_ids: z
    .array(objectIdSchema)
    .max(MAX_ITEMS.support, `You can attach up to ${MAX_ITEMS.support} screenshots.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Each screenshot can be attached once.')
    .default([]),
});

export const ticketIdParamsSchema = z.object({ id: objectIdSchema });
