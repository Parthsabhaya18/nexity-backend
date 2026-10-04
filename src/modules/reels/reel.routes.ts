import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { postCreateLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { objectIdSchema } from '../follows/follow.schema';
import { CAPTION_MAX } from '../posts/caption';
import { MEDIA_LOOKS } from '../media/media.looks';
import { LOCATION_MAX, MUSIC_MAX } from '../posts/post.model';
import { cursorQuerySchema } from '../posts/post.schema';
import * as reels from './reel.service';

const createSchema = z.object({
  video_media_id: objectIdSchema,
  caption: z.string().max(CAPTION_MAX).default('').transform((s) => s.trim()),
  location_name: z.string().trim().max(LOCATION_MAX).default(''),
  location_lat: z.number().min(-90).max(90).nullable().optional(),
  location_lng: z.number().min(-180).max(180).nullable().optional(),
  filter: z.enum(MEDIA_LOOKS).default('normal'),
  music_title: z.string().trim().max(MUSIC_MAX).default(''),
  audio_muted: z.boolean().default(false),
  cover_time_ms: z.number().int().min(0).max(3 * 60 * 1000).default(0),
  cover_media_id: objectIdSchema.optional(),
  client_upload_id: z.string().regex(/^[\w-]{8,64}$/).optional(),
  trim_start_ms: z.number().int().min(0).max(3 * 60 * 1000).nullable().optional(),
  trim_end_ms: z.number().int().min(0).max(3 * 60 * 1000).nullable().optional(),
});
const idParams = z.object({ reelId: objectIdSchema });
const commentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

const create: RequestHandler = async (req, res) => {
  const { reel, created } = await reels.createReel(req.user!, createSchema.parse(req.body));
  res.status(created ? 201 : 200).json(reel);
};
const list: RequestHandler = async (req, res) => {
  const { cursor, limit } = cursorQuerySchema.parse(req.query);
  res.json(await reels.reelFeed(req.user!, cursor, limit));
};
const like: RequestHandler = async (req, res) => {
  res.json(await reels.toggleReelLike(req.user!, idParams.parse(req.params).reelId));
};
const remove: RequestHandler = async (req, res) => {
  await reels.deleteReel(req.user!, idParams.parse(req.params).reelId);
  res.status(204).end();
};
const comments: RequestHandler = async (req, res) => {
  const { cursor, limit } = cursorQuerySchema.parse(req.query);
  res.json(await reels.listReelComments(req.user!, idParams.parse(req.params).reelId, cursor, limit));
};
const addComment: RequestHandler = async (req, res) => {
  const { body } = commentSchema.parse(req.body);
  res.status(201).json(await reels.addReelComment(req.user!, idParams.parse(req.params).reelId, body));
};

export const userReels: RequestHandler = async (req, res) => {
  const { userId } = z.object({ userId: objectIdSchema }).parse(req.params);
  const { cursor, limit } = cursorQuerySchema.parse(req.query);
  res.json(await reels.reelsByUser(req.user!, userId, cursor, limit));
};

export const reelsRouter = Router();
reelsRouter.use(requireAuth);
reelsRouter.get('/', list);
reelsRouter.post('/', postCreateLimiter, create);
reelsRouter.post('/:reelId/like', like);
reelsRouter.get('/:reelId/comments', comments);
reelsRouter.post('/:reelId/comments', addComment);
reelsRouter.delete('/:reelId', remove);
