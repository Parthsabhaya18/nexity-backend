import { Router } from 'express';

import { requireAuth } from '../../middlewares/requireAuth';
import { reportLimiter } from '../../middlewares/rateLimit';
import { report } from './safety.controller';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);
reportsRouter.post('/', reportLimiter, report);
