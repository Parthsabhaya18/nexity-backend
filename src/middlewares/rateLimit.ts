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

/** Change password and delete account check the password; stops guessing from a stolen session. */
export const passwordLimiter = limiter(10, account);

export const supportLimiter = limiter(10, account);

/** Follow, unfollow and request actions; stops follow-spam bots. */
export const followLimiter = limiter(200, account);

/** Content reports. A duplicate of the same target is stored once. */
export const reportLimiter = limiter(40, account);

export const searchLimiter = limiter(300, account);

/** Retries reuse `client_upload_id`, so this only stops spam. */
export const postCreateLimiter = limiter(60, account);

/** A 4 GB video needs ~30 part-URL batches, plus refreshes on slow networks. */
export const mediaPartsLimiter = limiter(600, account);

/** Nearby settings and location samples (one sample every ~2 minutes in the foreground). */
export const nearbyLimiter = limiter(120, account);

/** Reports and anonymous blocks of Secret Message senders. */
export const secretSafetyLimiter = limiter(40, account);

/** Adding and removing Secret Crushes: 30 a minute (the 10 adds a day rule is in the service). */
export const crushLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: account,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many Secret Crush changes. Wait a moment and try again.',
      },
    });
  },
});

function perAccount(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: account,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });
    },
  });
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const slowDown = 'Too many payment attempts. Wait a little and try again.';

/** razorpay-payments.md §10.3 */
export const paymentQuoteLimiter = perAccount(MINUTE, 20, slowDown);
export const paymentCheckoutLimiter = perAccount(HOUR, 10, slowDown);
export const paymentVerifyLimiter = perAccount(HOUR, 30, slowDown);
export const paymentStatusLimiter = perAccount(MINUTE, 60, slowDown);
export const paymentQrLimiter = perAccount(HOUR, 5, slowDown);
export const subscriptionManageLimiter = perAccount(HOUR, 10, slowDown);

/** Starting Secret Message threads: 10 a minute before any plan limit applies. */
export const secretStartLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: account,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: "You're sending Secret Messages too fast. Wait a moment and try again.",
      },
    });
  },
});

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
