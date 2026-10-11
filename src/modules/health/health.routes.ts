import { Router } from 'express';

import {
  clearDbTests,
  createDbTest,
  dbTestsOpen,
  getHealth,
  getReadiness,
  listDbTests,
  requireDbTestEnabled,
} from './health.controller';

export const healthRouter = Router();

healthRouter.get('/', getHealth);
healthRouter.get('/ready', getReadiness);

if (dbTestsOpen()) {
  healthRouter
    .route('/db-test')
    .all(requireDbTestEnabled)
    .get(listDbTests)
    .post(createDbTest)
    .delete(clearDbTests);
}
