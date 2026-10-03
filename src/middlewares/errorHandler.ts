import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ message: 'Validation failed', details: err.issues });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ message: err.message, details: err.details });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    message: 'Internal server error',
    ...(isProduction ? {} : { stack: (err as Error)?.stack }),
  });
};
