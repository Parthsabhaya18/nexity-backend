import type { RequestHandler } from 'express';
import { z } from 'zod';

import { objectIdSchema, pageQuerySchema } from '../follows/follow.schema';
import { listNotifications, markAllRead, markRead, unreadCount } from './notification.service';

export const list: RequestHandler = async (req, res) => {
  const { cursor, limit } = pageQuerySchema.parse(req.query);
  res.json(await listNotifications(req.user!, cursor, limit));
};

export const unread: RequestHandler = async (req, res) => {
  res.json(await unreadCount(req.user!));
};

export const readOne: RequestHandler = async (req, res) => {
  const { id } = z.object({ id: objectIdSchema }).parse(req.params);
  await markRead(req.user!, id);
  res.status(204).end();
};

export const readAll: RequestHandler = async (req, res) => {
  await markAllRead(req.user!);
  res.status(204).end();
};
