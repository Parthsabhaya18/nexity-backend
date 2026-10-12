import { Router } from 'express';

import { followLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { acceptRequest, declineRequest } from './follow.controller';

export const followRequestsRouter = Router();

followRequestsRouter.use(requireAuth);

followRequestsRouter.post('/:id/accept', followLimiter, acceptRequest);
followRequestsRouter.post('/:id/decline', followLimiter, declineRequest);
