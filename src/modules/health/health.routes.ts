import { Router } from 'express';

import {
  clearDbTests,
  createDbTest,
  getHealth,
  getReadiness,
  listDbTests,
  requireDbTestEnabled,
} from './health.controller';

export const healthRouter = Router();

healthRouter.get('/', getHealth);
healthRouter.get('/ready', getReadiness);

healthRouter
  .route('/db-test')
  .all(requireDbTestEnabled)
  .get(listDbTests)
  .post(createDbTest)
  .delete(clearDbTests);
