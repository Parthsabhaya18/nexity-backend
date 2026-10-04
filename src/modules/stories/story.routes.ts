import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { requireAuth } from '../../middlewares/requireAuth';
import { objectIdSchema } from '../follows/follow.schema';
import { MEDIA_LOOKS } from '../media/media.looks';
import { LOCATION_MAX, MUSIC_MAX } from '../posts/post.model';
import { storyOverlaysSchema } from './story.schema';
import * as stories from './story.service';

const mediaBody = z.object({
  media_id: objectIdSchema,
  music_title: z.string().trim().max(MUSIC_MAX).default(''),
  location_name: z.string().trim().max(LOCATION_MAX).default(''),
  location_lat: z.number().min(-90).max(90).nullable().optional(),
  location_lng: z.number().min(-180).max(180).nullable().optional(),
  filter: z.enum(MEDIA_LOOKS).default('normal'),
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

const create: RequestHandler = async (req, res) => {
  res.status(201).json(await stories.createStory(req.user!, mediaBody.parse(req.body)));
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

export const storiesRouter = Router();
storiesRouter.use(requireAuth);
storiesRouter.get('/tray', tray);
storiesRouter.post('/', create);
storiesRouter.get('/:storyId/viewers', viewers);
storiesRouter.post('/:storyId/view', view);
storiesRouter.post('/:storyId/vote', vote);
storiesRouter.post('/:storyId/reply', reply);
storiesRouter.delete('/:storyId', remove);
