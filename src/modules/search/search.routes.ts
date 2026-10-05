import { Router } from 'express';

import { searchLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import {
  clearSearchHistory,
  deleteSearchHistoryItem,
  getSearchHistory,
  saveSearchHistory,
  search,
} from './search.controller';

export const searchRouter = Router();

searchRouter.use(requireAuth);
searchRouter.get('/history', getSearchHistory);
searchRouter.post('/history', saveSearchHistory);
searchRouter.delete('/history', clearSearchHistory);
searchRouter.delete('/history/:userId', deleteSearchHistoryItem);
searchRouter.get('/', searchLimiter, search);
