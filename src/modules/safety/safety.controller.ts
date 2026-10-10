import type { RequestHandler } from 'express';
import { z } from 'zod';

import { pageQuerySchema, userIdParamsSchema } from '../follows/follow.schema';
import { blockUser, listBlocked, unblockUser } from './block.service';
import { muteUser, unmuteUser } from './mute.service';
import { REPORT_REASONS, REPORT_TARGETS } from './report.model';
import { createReport } from './report.service';

const reportSchema = z
  .object({
    target_type: z.enum(REPORT_TARGETS),
    target_id: z.string().trim().min(1).max(64),
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(500).default(''),
  })
  .strict();

export const block: RequestHandler = async (req, res) => {
  await blockUser(req.user!, userIdParamsSchema.parse(req.params).userId);
  res.status(204).end();
};

export const unblock: RequestHandler = async (req, res) => {
  await unblockUser(req.user!, userIdParamsSchema.parse(req.params).userId);
  res.status(204).end();
};

export const mute: RequestHandler = async (req, res) => {
  await muteUser(req.user!, userIdParamsSchema.parse(req.params).userId);
  res.status(204).end();
};

export const unmute: RequestHandler = async (req, res) => {
  await unmuteUser(req.user!, userIdParamsSchema.parse(req.params).userId);
  res.status(204).end();
};

export const blocked: RequestHandler = async (req, res) => {
  res.json(await listBlocked(req.user!, pageQuerySchema.parse(req.query)));
};

export const report: RequestHandler = async (req, res) => {
  await createReport(req.user!, reportSchema.parse(req.body));
  res.status(201).json({ ok: true });
};
