import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { env } from '../config/env';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function limiter(limit: number, key: (req: Request) => string) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: key,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests. Please wait a few minutes and try again.',
        },
      });
    },
  });
}

const ip = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

/** Carrier-grade NAT shares IPs, so login limits are per IP + identifier. */
export const loginLimiter = limiter(20, (req) => {
  const id =
    typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
  return `${ip(req)}:${id}`;
});

export const authLimiter = limiter(60, ip);
