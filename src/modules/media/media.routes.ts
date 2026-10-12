import { Router } from 'express';

import { mediaPartsLimiter, mediaUploadLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import {
  completeUpload,
  createUpload,
  deleteMedia,
  getMedia,
  listParts,
  presignParts,
} from './media.controller';

export const mediaRouter = Router();

mediaRouter.use(requireAuth);

mediaRouter.post('/uploads', mediaUploadLimiter, createUpload);
mediaRouter.post('/:id/parts', mediaPartsLimiter, presignParts);
mediaRouter.get('/:id/parts', mediaPartsLimiter, listParts);
mediaRouter.post('/:id/complete', completeUpload);
mediaRouter.get('/:id', getMedia);
mediaRouter.delete('/:id', deleteMedia);
