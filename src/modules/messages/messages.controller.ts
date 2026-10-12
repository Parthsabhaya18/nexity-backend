import type { RequestHandler } from 'express';

import {
  createConversationSchema,
  editMessageSchema,
  idParamSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markReadSchema,
  messageParamsSchema,
  muteSchema,
  reactionSchema,
  sendMessageSchema,
} from './messages.schema';
import * as messages from './messages.service';

const userIdOf = (req: Parameters<RequestHandler>[0]) => req.user!.id as string;

export const listConversations: RequestHandler = async (req, res) => {
  const query = listConversationsQuerySchema.parse(req.query);
  res.json(await messages.listConversations(userIdOf(req), query));
};

export const createConversation: RequestHandler = async (req, res) => {
  const { participant_ids } = createConversationSchema.parse(req.body);
  const result = await messages.openDirectConversation(userIdOf(req), participant_ids[0]!);
  res.status(result.created ? 201 : 200).json(result.conversation);
};

export const getConversation: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.json(await messages.getConversation(userIdOf(req), id));
};

export const deleteConversation: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  await messages.deleteConversationForMe(userIdOf(req), id);
  res.status(204).end();
};

export const muteConversation: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { muted } = muteSchema.parse(req.body);
  res.json(await messages.setMuted(userIdOf(req), id, muted));
};

export const listMessages: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const query = listMessagesQuerySchema.parse(req.query);
  res.json(await messages.listMessages(userIdOf(req), id, query));
};

export const sendMessage: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const input = sendMessageSchema.parse(req.body);
  res.status(201).json(await messages.sendMessage(userIdOf(req), id, input));
};

export const unsendMessage: RequestHandler = async (req, res) => {
  const { id, messageId } = messageParamsSchema.parse(req.params);
  res.json(await messages.unsendMessage(userIdOf(req), id, messageId));
};

export const editMessage: RequestHandler = async (req, res) => {
  const { id, messageId } = messageParamsSchema.parse(req.params);
  const { body } = editMessageSchema.parse(req.body);
  res.json(await messages.editMessage(userIdOf(req), id, messageId, body));
};

export const setReaction: RequestHandler = async (req, res) => {
  const { id, messageId } = messageParamsSchema.parse(req.params);
  const { emoji } = reactionSchema.parse(req.body);
  res.json(await messages.setReaction(userIdOf(req), id, messageId, emoji));
};

export const removeReaction: RequestHandler = async (req, res) => {
  const { id, messageId } = messageParamsSchema.parse(req.params);
  res.json(await messages.setReaction(userIdOf(req), id, messageId, null));
};

export const markRead: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { message_id } = markReadSchema.parse(req.body ?? {});
  res.json(await messages.markRead(userIdOf(req), id, message_id));
};
