import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';

import { isProduction } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

const MONGO_DUPLICATE_KEY = 11000;

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
  extra?: Record<string, unknown>,
) {
  res.status(status).json({
    error: { code, message, ...(details === undefined ? {} : { details }), ...extra },
  });
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    sendError(res, 400, 'VALIDATION_ERROR', details[0]?.message ?? 'Validation failed', details);
    return;
  }

  if (err instanceof ApiError) {
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Validation failed',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    sendError(res, 400, 'VALIDATION_ERROR', `Invalid value for "${err.path}"`);
    return;
  }

  if (err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY) {
    sendError(res, 409, 'CONFLICT', 'Resource already exists', {
      fields: Object.keys((err.keyValue as Record<string, unknown> | undefined) ?? {}),
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  sendError(
    res,
    500,
    'INTERNAL_ERROR',
    'Internal server error',
    undefined,
    isProduction ? {} : { stack: (err as Error)?.stack },
  );
};
