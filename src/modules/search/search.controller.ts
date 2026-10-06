import type { RequestHandler } from 'express';
import { z } from 'zod';

import { objectIdSchema } from '../follows/follow.schema';
import { mentionUsers, searchPlaces, searchUsers, suggestUsers } from './search.service';
import {
  addHistory,
  clearHistory,
  listHistory,
  removeHistory,
} from './searchHistory.service';

const limitSchema = z.coerce.number().int().min(1).max(50).default(20).catch(20);

const searchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  type: z.enum(['users', 'places']).default('users').catch('users'),
  limit: limitSchema,
});

export const suggestions: RequestHandler = async (req, res) => {
  const limit = limitSchema.parse(req.query.limit);
  res.json({ users: await suggestUsers(req.user!, limit) });
};

const mentionQuerySchema = z.object({
  q: z.string().trim().max(31).default('').catch(''),
  limit: z.coerce.number().int().min(1).max(20).default(5).catch(5),
});

export const mentionSuggestions: RequestHandler = async (req, res) => {
  const { q, limit } = mentionQuerySchema.parse(req.query);
  res.json({ users: await mentionUsers(req.user!, q, limit) });
};

export const search: RequestHandler = async (req, res) => {
  const { q, type, limit } = searchQuerySchema.parse(req.query);
  if (type === 'places') {
    res.json({ places: await searchPlaces(req.user!, q, limit) });
  } else {
    res.json({ users: await searchUsers(req.user!, q, limit) });
  }
};

export const getSearchHistory: RequestHandler = async (req, res) => {
  res.json({ users: await listHistory(req.user!) });
};

export const saveSearchHistory: RequestHandler = async (req, res) => {
  const { user_id } = z.object({ user_id: objectIdSchema }).parse(req.body);
  await addHistory(req.user!, user_id);
  res.status(204).end();
};

export const deleteSearchHistoryItem: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: objectIdSchema }).parse(req.params);
  await removeHistory(req.user!, userId);
  res.status(204).end();
};

export const clearSearchHistory: RequestHandler = async (req, res) => {
  await clearHistory(req.user!);
  res.status(204).end();
};
