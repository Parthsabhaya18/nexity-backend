import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { requireAuth } from '../../middlewares/requireAuth';
import { objectIdSchema } from '../follows/follow.schema';
import { LOCATION_MAX } from '../posts/post.model';
import { storyOverlaysSchema } from './story.schema';
import * as stories from './story.service';

const mediaBody = z.object({
  media_id: objectIdSchema,
  location_name: z.string().trim().max(LOCATION_MAX).default(''),
  location_lat: z.number().min(-90).max(90).nullable().optional(),
  location_lng: z.number().min(-180).max(180).nullable().optional(),
  overlays: storyOverlaysSchema,
});
const idParams = z.object({ storyId: objectIdSchema });
const voteBody = z.object({
  overlay_id: z.string().trim().min(4).max(40),
  option: z.number().int().min(0).max(3),
});
const replyBody = z.object({
  overlay_id: z.string().trim().min(4).max(40),
  body: z.string().trim().min(1).max(80),
});

const messageBody = z.object({ body: z.string().trim().min(1).max(500) });

const shareBody = z.object({
  kind: z.enum(['post', 'reel']),
  id: objectIdSchema,
  media_index: z.number().int().min(0).max(19).default(0),
  location_name: z.string().trim().max(LOCATION_MAX).default(''),
  location_lat: z.number().min(-90).max(90).nullable().optional(),
  location_lng: z.number().min(-180).max(180).nullable().optional(),
  overlays: storyOverlaysSchema,
  layout: z
    .object({
      x: z.number().min(-0.5).max(1.5),
      y: z.number().min(-0.5).max(1.5),
      scale: z.number().min(0.2).max(5),
      style: z.enum(['media', 'card']).default('media'),
    })
    .optional(),
});

const create: RequestHandler = async (req, res) => {
  res.status(201).json(await stories.createStory(req.user!, mediaBody.parse(req.body)));
};
const share: RequestHandler = async (req, res) => {
  res.status(201).json(await stories.createSharedStory(req.user!, shareBody.parse(req.body)));
};
const tray: RequestHandler = async (req, res) => {
  res.json(await stories.storyTray(req.user!));
};
const view: RequestHandler = async (req, res) => {
  await stories.markViewed(req.user!, idParams.parse(req.params).storyId);
  res.status(204).end();
};
const viewers: RequestHandler = async (req, res) => {
  res.json(await stories.storyViewers(req.user!, idParams.parse(req.params).storyId));
};
const remove: RequestHandler = async (req, res) => {
  await stories.deleteStory(req.user!, idParams.parse(req.params).storyId);
  res.status(204).end();
};
const vote: RequestHandler = async (req, res) => {
  const { storyId } = idParams.parse(req.params);
  const { overlay_id, option } = voteBody.parse(req.body);
  res.json(await stories.votePoll(req.user!, storyId, overlay_id, option));
};
const reply: RequestHandler = async (req, res) => {
  const { storyId } = idParams.parse(req.params);
  const { overlay_id, body } = replyBody.parse(req.body);
  res.status(201).json(await stories.replyQuestion(req.user!, storyId, overlay_id, body));
};

const likeOn: RequestHandler = async (req, res) => {
  res.json(await stories.setStoryLike(req.user!, idParams.parse(req.params).storyId, true));
};
const likeOff: RequestHandler = async (req, res) => {
  res.json(await stories.setStoryLike(req.user!, idParams.parse(req.params).storyId, false));
};
const message: RequestHandler = async (req, res) => {
  const { body } = messageBody.parse(req.body);
  res.status(201).json(await stories.messageStory(req.user!, idParams.parse(req.params).storyId, body));
};

export const storiesRouter = Router();
storiesRouter.use(requireAuth);
storiesRouter.get('/tray', tray);
storiesRouter.post('/', create);
/** Adds a post or reel to your story. */
storiesRouter.post('/share', share);
storiesRouter.get('/:storyId/viewers', viewers);
storiesRouter.post('/:storyId/view', view);
storiesRouter.post('/:storyId/vote', vote);
storiesRouter.post('/:storyId/reply', reply);
storiesRouter.put('/:storyId/like', likeOn);
storiesRouter.delete('/:storyId/like', likeOff);
storiesRouter.post('/:storyId/message', message);
storiesRouter.delete('/:storyId', remove);
