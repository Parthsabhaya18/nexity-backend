import type { RequestHandler } from 'express';
import { z } from 'zod';

import { isDatabaseConnected } from '../../config/database';
import { env, isProduction } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { HealthCheck } from './healthCheck.model';

export const getHealth: RequestHandler = (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    database: isDatabaseConnected() ? 'connected' : 'disconnected',
  });
};

/** Readiness probe: 503 until MongoDB is reachable, so load balancers only route to ready instances. */
export const getReadiness: RequestHandler = (_req, res) => {
  const ready = isDatabaseConnected();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unavailable',
    database: ready ? 'connected' : 'disconnected',
  });
};

/** The db-test endpoints write to MongoDB without auth, so they must never be reachable in production. */
export const requireDbTestEnabled: RequestHandler = (req, res, next) => {
  if (isProduction) {
    next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
    return;
  }
  if (!isDatabaseConnected()) {
    res.status(503).json({ message: 'Database is not connected', database: 'disconnected' });
    return;
  }
  next();
};

const createDbTestSchema = z.object({
  message: z.string().trim().min(1).max(200).default('MongoDB connection test'),
  source: z.string().trim().min(1).max(50).default('api'),
});

function toDto(doc: InstanceType<typeof HealthCheck>) {
  return {
    id: doc.id as string,
    message: doc.message,
    source: doc.source,
    created_at: (doc.get('created_at') as Date).toISOString(),
  };
}

/** Inserts a document and reads it back, proving both writes and reads reach MongoDB. */
export const createDbTest: RequestHandler = async (req, res) => {
  const input = createDbTestSchema.parse(req.body ?? {});
  const created = await HealthCheck.create(input);
  const readBack = await HealthCheck.findById(created._id);

  res.status(201).json({
    status: readBack ? 'ok' : 'write_not_readable',
    database: 'connected',
    db_name: HealthCheck.db.name,
    collection: HealthCheck.collection.name,
    data: readBack ? toDto(readBack) : null,
  });
};

export const listDbTests: RequestHandler = async (_req, res) => {
  const [total, docs] = await Promise.all([
    HealthCheck.countDocuments(),
    HealthCheck.find().sort({ created_at: -1 }).limit(20),
  ]);

  res.json({
    database: 'connected',
    db_name: HealthCheck.db.name,
    collection: HealthCheck.collection.name,
    total,
    data: docs.map(toDto),
  });
};

export const clearDbTests: RequestHandler = async (_req, res) => {
  const { deletedCount } = await HealthCheck.deleteMany({});
  res.json({ deleted: deletedCount });
};
