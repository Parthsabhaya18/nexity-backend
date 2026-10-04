import type { RequestHandler } from 'express';
import { z } from 'zod';

import { searchPlaces, searchTags, searchUsers, suggestUsers } from './search.service';

const limitSchema = z.coerce.number().int().min(1).max(50).default(20).catch(20);

const searchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  type: z.enum(['users', 'tags', 'places']).default('users').catch('users'),
  limit: limitSchema,
});

export const suggestions: RequestHandler = async (req, res) => {
  const limit = limitSchema.parse(req.query.limit);
  res.json({ users: await suggestUsers(req.user!, limit) });
};

export const search: RequestHandler = async (req, res) => {
  const { q, type, limit } = searchQuerySchema.parse(req.query);
  if (type === 'tags') {
    res.json({ tags: await searchTags(q, limit) });
  } else if (type === 'places') {
    res.json({ places: await searchPlaces(req.user!, q, limit) });
  } else {
    res.json({ users: await searchUsers(req.user!, q, limit) });
  }
};
