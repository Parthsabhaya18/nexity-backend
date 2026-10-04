import { Router } from 'express';

import { searchLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { search } from './search.controller';

export const searchRouter = Router();

searchRouter.get('/', requireAuth, searchLimiter, search);
