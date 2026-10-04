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

const account = (req: Request) => (req.user ? `user:${req.user.id as string}` : ip(req));

/** Runs after requireAuth, so uploads are limited per account. */
export const mediaUploadLimiter = limiter(150, account);

export const profileUpdateLimiter = limiter(60, account);

/** Follow, unfollow and request actions; stops follow-spam bots. */
export const followLimiter = limiter(200, account);

/** Content reports. A duplicate of the same target is stored once. */
export const reportLimiter = limiter(40, account);

export const searchLimiter = limiter(300, account);

/** Retries reuse `client_upload_id`, so this only stops spam. */
export const postCreateLimiter = limiter(60, account);

/** A 4 GB video needs ~30 part-URL batches, plus refreshes on slow networks. */
export const mediaPartsLimiter = limiter(600, account);

/** Per-user send limit; generous for real conversations, stops scripted flooding. */
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => (req.user?.id as string | undefined) ?? ip(req),
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: "You're sending messages too fast. Wait a moment and try again.",
      },
    });
  },
});
