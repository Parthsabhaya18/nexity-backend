import { Router } from 'express';

import { requireAuth } from '../../middlewares/requireAuth';
import { list, readAll, readOne, unread } from './notification.controller';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);
notificationsRouter.get('/', list);
notificationsRouter.get('/unread-count', unread);
notificationsRouter.post('/read-all', readAll);
notificationsRouter.post('/:id/read', readOne);
