import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { messageLimiter, searchLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { objectIdSchema } from '../follows/follow.schema';
import { MESSAGE_MAX_LENGTH } from '../messages/message.model';
import * as shares from './share.service';

const MAX_RECIPIENTS = 20;

const targetsQuery = z.object({
  q: z.string().trim().max(50).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

const sendBody = z.object({
  kind: z.enum(['post', 'reel', 'profile']),
  id: objectIdSchema,
  user_ids: z
    .array(objectIdSchema)
    .min(1, 'Pick someone to send it to.')
    .max(MAX_RECIPIENTS, `You can send to up to ${MAX_RECIPIENTS} people at once.`),
  body: z.string().trim().max(MESSAGE_MAX_LENGTH).default(''),
  media_index: z.number().int().min(0).max(19).default(0),
});

const targets: RequestHandler = async (req, res) => {
  const { q, limit } = targetsQuery.parse(req.query);
  res.json(await shares.shareTargets(req.user!, q, limit));
};

const send: RequestHandler = async (req, res) => {
  res.status(201).json(await shares.shareToPeople(req.user!, sendBody.parse(req.body)));
};

export const sharesRouter = Router();
sharesRouter.use(requireAuth);
sharesRouter.get('/targets', searchLimiter, targets);
sharesRouter.post('/', messageLimiter, send);
