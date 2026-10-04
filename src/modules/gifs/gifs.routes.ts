import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { requireAuth } from '../../middlewares/requireAuth';
import * as gifs from './gifs.service';

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(24),
  cursor: z.coerce.number().int().min(0).max(4999).default(0),
  type: z.enum(gifs.GIF_KINDS).default('gif'),
});

const searchSchema = pageSchema.extend({
  q: z.string().trim().min(1).max(50),
});

const trending: RequestHandler = async (req, res) => {
  const { limit, cursor, type } = pageSchema.parse(req.query);
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await gifs.trending(limit, cursor, type));
};

const search: RequestHandler = async (req, res) => {
  const { q, limit, cursor, type } = searchSchema.parse(req.query);
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await gifs.search(q, limit, cursor, type));
};

export const gifsRouter = Router();

gifsRouter.use(requireAuth);
gifsRouter.get('/trending', trending);
gifsRouter.get('/search', search);
