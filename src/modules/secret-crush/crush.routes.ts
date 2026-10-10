import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import { crushLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import {
  addCrush,
  crushStatus,
  getMatch,
  listCrushes,
  listMatches,
  markCelebrated,
  removeCrush,
  summary,
} from './crush.service';

const addSchema = z.object({ user_id: z.string().trim().min(1).max(64) }).strict();
const userParams = z.object({ userId: z.string().trim().min(1).max(64) });
const matchParams = z.object({ matchId: z.uuid() });

const userId = (params: unknown) => userParams.parse(params).userId;
const matchId = (params: unknown) => matchParams.parse(params).matchId;

const getSummary: RequestHandler = async (req, res) => {
  res.json(await summary(req.user!));
};
const getList: RequestHandler = async (req, res) => {
  res.json(await listCrushes(req.user!));
};
const postCrush: RequestHandler = async (req, res) => {
  res.status(201).json(await addCrush(req.user!, addSchema.parse(req.body).user_id));
};
const deleteCrush: RequestHandler = async (req, res) => {
  await removeCrush(req.user!, userId(req.params));
  res.status(204).end();
};
const getStatus: RequestHandler = async (req, res) => {
  res.json(await crushStatus(req.user!, userId(req.params)));
};
const getMatches: RequestHandler = async (req, res) => {
  res.json(await listMatches(req.user!));
};
const getOneMatch: RequestHandler = async (req, res) => {
  res.json(await getMatch(req.user!, matchId(req.params)));
};
const postCelebrated: RequestHandler = async (req, res) => {
  await markCelebrated(req.user!, matchId(req.params));
  res.status(204).end();
};

export const secretCrushRouter = Router();
secretCrushRouter.use(requireAuth);
secretCrushRouter.get('/summary', getSummary);
secretCrushRouter.get('/matches', getMatches);
secretCrushRouter.get('/matches/:matchId', getOneMatch);
secretCrushRouter.post('/matches/:matchId/celebrated', postCelebrated);
secretCrushRouter.get('/status/:userId', getStatus);
secretCrushRouter.get('/', getList);
secretCrushRouter.post('/', crushLimiter, postCrush);
secretCrushRouter.delete('/:userId', crushLimiter, deleteCrush);
