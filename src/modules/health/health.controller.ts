import type { RequestHandler } from 'express';

import { env } from '../../config/env';

export const getHealth: RequestHandler = (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
};
