import { Router } from 'express';

import { messageLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import {
  createConversation,
  deleteConversation,
  editMessage,
  getConversation,
  listConversations,
  listMessages,
  markRead,
  muteConversation,
  removeReaction,
  sendMessage,
  setReaction,
  unsendMessage,
} from './messages.controller';

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

conversationsRouter.get('/', listConversations);
conversationsRouter.post('/', createConversation);
conversationsRouter.get('/:id', getConversation);
conversationsRouter.delete('/:id', deleteConversation);
conversationsRouter.post('/:id/mute', muteConversation);
conversationsRouter.get('/:id/messages', listMessages);
conversationsRouter.post('/:id/messages', messageLimiter, sendMessage);
conversationsRouter.patch('/:id/messages/:messageId', editMessage);
conversationsRouter.delete('/:id/messages/:messageId', unsendMessage);
conversationsRouter.put('/:id/messages/:messageId/reaction', setReaction);
conversationsRouter.delete('/:id/messages/:messageId/reaction', removeReaction);
conversationsRouter.post('/:id/read', markRead);
