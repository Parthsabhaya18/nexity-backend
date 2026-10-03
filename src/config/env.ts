import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_PREFIX: z.string().default('/api/v1'),
    CORS_ORIGINS: z
      .string()
      .default('*')
      .transform((v) => v.split(',').map((o) => o.trim())),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    MONGODB_URI: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .regex(/^mongodb(\+srv)?:\/\/.+/, 'must start with mongodb:// or mongodb+srv://')
        .optional(),
    ),
    MONGODB_DB_NAME: z
      .string()
      .trim()
      .regex(/^[^/\\. "$]{1,63}$/, 'invalid MongoDB database name')
      .default('nexity'),
    MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(10),
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    JWT_ACCESS_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

    SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
    MAIL_FROM: z.string().default('Nexity <no-reply@nexity.app>'),
  })
  .superRefine((cfg, ctx) => {
    // Tests spin up their own in-memory MongoDB, so the URI is only mandatory outside `test`.
    if (cfg.NODE_ENV !== 'test' && !cfg.MONGODB_URI) {
      ctx.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'MONGODB_URI is required' });
    }
    if (cfg.NODE_ENV === 'production' && !cfg.JWT_ACCESS_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET is required in production',
      });
    }
    if (cfg.NODE_ENV === 'production' && !cfg.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required in production so OTP emails can be sent',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';

/** Development and test fall back to a fixed secret so the API runs without extra setup. */
export const jwtAccessSecret =
  env.JWT_ACCESS_SECRET ?? 'nexity-development-only-secret-change-me-0000';

export const isMailConfigured = Boolean(env.SMTP_HOST);

/** Without SMTP outside production, OTP codes are returned in API responses so the app can be tested. */
export const exposeDevOtp = !isProduction && !isMailConfigured;
