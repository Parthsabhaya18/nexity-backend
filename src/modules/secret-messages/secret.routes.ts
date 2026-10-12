import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import {
  messageLimiter,
  secretSafetyLimiter,
  secretStartLimiter,
} from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { REPORT_REASONS } from '../safety/report.model';
import {
  BODY_MAX,
  FIRST_MAX,
  blockSender,
  deleteThread,
  getThread,
  listInbox,
  listSecretBlocks,
  listSent,
  listThreadMessages,
  markThreadRead,
  removeSecretBlock,
  reportThread,
  sendThreadMessage,
  startThread,
  summary,
} from './secret.service';

const clientMessageId = z.string().trim().min(8).max(64);

const startSchema = z
  .object({
    recipient_id: z.string().trim().min(1).max(64),
    body: z.string().max(FIRST_MAX * 2),
    client_message_id: clientMessageId,
  })
  .strict();

const sendSchema = z
  .object({ body: z.string().max(BODY_MAX * 2), client_message_id: clientMessageId })
  .strict();

const reportSchema = z
  .object({ reason: z.enum(REPORT_REASONS), details: z.string().trim().max(500).default('') })
  .strict();

const pageSchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const threadParams = z.object({ threadId: z.uuid() });
const blockParams = z.object({ blockId: z.uuid() });

const threadId = (params: unknown) => threadParams.parse(params).threadId;

const getSummary: RequestHandler = async (req, res) => {
  res.json(await summary(req.user!));
};
const getInbox: RequestHandler = async (req, res) => {
  res.json(await listInbox(req.user!, pageSchema.parse(req.query)));
};
const getSent: RequestHandler = async (req, res) => {
  res.json(await listSent(req.user!, pageSchema.parse(req.query)));
};
const postThread: RequestHandler = async (req, res) => {
  const result = await startThread(req.user!, startSchema.parse(req.body));
  res.status(result.created ? 201 : 200).json(result.thread);
};
const getOne: RequestHandler = async (req, res) => {
  res.json(await getThread(req.user!, threadId(req.params)));
};
const getMessages: RequestHandler = async (req, res) => {
  res.json(await listThreadMessages(req.user!, threadId(req.params)));
};
const postMessage: RequestHandler = async (req, res) => {
  res.status(201).json(await sendThreadMessage(req.user!, threadId(req.params), sendSchema.parse(req.body)));
};
const postRead: RequestHandler = async (req, res) => {
  await markThreadRead(req.user!, threadId(req.params));
  res.status(204).end();
};
const postReport: RequestHandler = async (req, res) => {
  await reportThread(req.user!, threadId(req.params), reportSchema.parse(req.body));
  res.status(201).json({ ok: true });
};
const postBlock: RequestHandler = async (req, res) => {
  await blockSender(req.user!, threadId(req.params));
  res.status(204).end();
};
const deleteOne: RequestHandler = async (req, res) => {
  await deleteThread(req.user!, threadId(req.params));
  res.status(204).end();
};

export const secretMessagesRouter = Router();
secretMessagesRouter.use(requireAuth);
secretMessagesRouter.get('/summary', getSummary);
secretMessagesRouter.get('/inbox', getInbox);
secretMessagesRouter.get('/sent', getSent);
secretMessagesRouter.post('/', secretStartLimiter, postThread);
secretMessagesRouter.get('/:threadId', getOne);
secretMessagesRouter.get('/:threadId/messages', getMessages);
secretMessagesRouter.post('/:threadId/messages', messageLimiter, postMessage);
secretMessagesRouter.post('/:threadId/read', postRead);
secretMessagesRouter.post('/:threadId/report', secretSafetyLimiter, postReport);
secretMessagesRouter.post('/:threadId/block-sender', secretSafetyLimiter, postBlock);
secretMessagesRouter.delete('/:threadId', deleteOne);

/** Mounted at /users/me/secret-blocks. Entries never show who was blocked. */
export const secretBlocksRouter = Router();
secretBlocksRouter.use(requireAuth);
secretBlocksRouter.get('/', async (req, res) => {
  res.json(await listSecretBlocks(req.user!));
});
secretBlocksRouter.delete('/:blockId', async (req, res) => {
  await removeSecretBlock(req.user!, blockParams.parse(req.params).blockId);
  res.status(204).end();
});
