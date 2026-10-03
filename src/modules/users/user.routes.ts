import { Router } from 'express';

import { requireAuth } from '../../middlewares/requireAuth';
import { me } from '../auth/auth.controller';

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, me);
