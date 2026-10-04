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

    KEEP_ALIVE_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    KEEP_ALIVE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),
    RENDER_EXTERNAL_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    APP_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),

    AWS_REGION: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    // Optional: without keys the SDK default chain is used (IAM role, ~/.aws, etc.).
    AWS_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    AWS_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    S3_BUCKET: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    // S3-compatible endpoint (MinIO, LocalStack). Leave empty for AWS.
    S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
    // CloudFront (or bucket) origin that serves uploaded files, without a trailing slash.
    MEDIA_PUBLIC_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    MEDIA_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

    GIPHY_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    GIPHY_RATING: z.enum(['g', 'pg', 'pg-13', 'r']).default('pg-13'),
    /** How long a user stays "online" after their last chat socket drops. */
    PRESENCE_OFFLINE_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(15_000),
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
    if (cfg.NODE_ENV === 'production') {
      for (const key of ['AWS_REGION', 'S3_BUCKET'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required in production for media uploads`,
          });
        }
      }
    }
    if (Boolean(cfg.AWS_ACCESS_KEY_ID) !== Boolean(cfg.AWS_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AWS_SECRET_ACCESS_KEY'],
        message: 'Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or neither',
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

export const isMailConfigured = env.NODE_ENV !== 'test' && Boolean(env.SMTP_HOST);

export const isMediaConfigured = Boolean(env.AWS_REGION && env.S3_BUCKET);

/** Without SMTP outside production, OTP codes are returned in API responses so the app can be tested. */
export const exposeDevOtp = !isProduction && !isMailConfigured;
