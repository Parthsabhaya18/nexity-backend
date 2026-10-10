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
    // Brevo's HTTPS API, for hosts that block outbound SMTP (Render's free tier). Used instead of SMTP when set.
    BREVO_API_KEY: z.preprocess(emptyToUndefined, z.string().trim().optional()),

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

    /** 32 random bytes (base64) used to encrypt Secret Message bodies at rest. Required in production. */
    SECRET_MESSAGES_KEY: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    /** Lets testers switch plan without paying (`POST /subscriptions/dev/activate`). Never on in production. */
    DEV_PLAN_SWITCH: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),

    /** Razorpay (razorpay-payments.md §9). Without keys, non-production builds use the built-in simulator. */
    RAZORPAY_KEY_ID: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    RAZORPAY_KEY_SECRET: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    RAZORPAY_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    /** Logo shown inside the Razorpay checkout sheet. */
    RAZORPAY_LOGO_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    /** Platforms that may pay with Razorpay. Android and iOS use the same checkout. */
    PAYMENTS_ENABLED_PLATFORMS: z
      .string()
      .default('android,ios,web')
      .transform((v) => v.split(',').map((p) => p.trim().toLowerCase())),

    NEARBY_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    NEARBY_RADIUS_METERS: z.coerce.number().int().min(5).max(1000).default(50),
    NEARBY_MIN_ENCOUNTER_DURATION_SECONDS: z.coerce.number().int().min(0).max(3600).default(120),
    NEARBY_LOCATION_ACCURACY_LIMIT_METERS: z.coerce.number().int().min(5).max(5000).default(40),
    NEARBY_LOCATION_SAMPLE_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
    NEARBY_ENCOUNTER_COOLDOWN_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
    NEARBY_NOTIFICATION_COOLDOWN_MINUTES: z.coerce.number().int().min(0).max(10_080).default(360),
    NEARBY_MAX_PUSHES_PER_DAY: z.coerce.number().int().min(0).max(100).default(3),
    NEARBY_ENCOUNTER_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(2),
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
    if (cfg.NODE_ENV === 'production' && !cfg.SMTP_HOST && !cfg.BREVO_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST or BREVO_API_KEY is required in production so OTP emails can be sent',
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
    if (cfg.NODE_ENV === 'production' && !cfg.SECRET_MESSAGES_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SECRET_MESSAGES_KEY'],
        message: 'SECRET_MESSAGES_KEY is required in production to encrypt Secret Messages',
      });
    }
    if (
      cfg.SECRET_MESSAGES_KEY &&
      Buffer.from(cfg.SECRET_MESSAGES_KEY, 'base64').length !== 32
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['SECRET_MESSAGES_KEY'],
        message: 'SECRET_MESSAGES_KEY must be 32 bytes encoded as base64',
      });
    }
    if (cfg.NODE_ENV === 'production' && cfg.DEV_PLAN_SWITCH) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_PLAN_SWITCH'],
        message: 'DEV_PLAN_SWITCH must be off in production',
      });
    }
    if (Boolean(cfg.RAZORPAY_KEY_ID) !== Boolean(cfg.RAZORPAY_KEY_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['RAZORPAY_KEY_SECRET'],
        message: 'Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or neither',
      });
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

export const isMailConfigured =
  env.NODE_ENV !== 'test' && Boolean(env.SMTP_HOST || env.BREVO_API_KEY);

/** Public origin of this API, for links and images inside emails. */
export const publicBaseUrl = env.RENDER_EXTERNAL_URL ?? env.APP_URL;

export const isMediaConfigured = Boolean(env.AWS_REGION && env.S3_BUCKET);

/** Without SMTP outside production, OTP codes are returned in API responses so the app can be tested. */
export const exposeDevOtp = !isProduction && !isMailConfigured;

/** Vitest sets VITEST. Tests must not follow a developer machine's live payment settings. */
const isAutomatedTest = env.NODE_ENV === 'test' || process.env.VITEST === 'true';

/** Plans can be switched without payment until store billing ships (never in production). */
export const devPlanSwitch =
  isAutomatedTest || (!isProduction && (env.DEV_PLAN_SWITCH ?? true));

/**
 * `razorpay` with keys; `simulator` (fake Razorpay inside this server, no money moves) in
 * development without keys; `off` in production without keys.
 * Automated tests always use the simulator, even when a developer `.env` contains Razorpay keys,
 * so `vitest` never creates a live order or moves money.
 */
export const paymentsMode: 'razorpay' | 'simulator' | 'off' = isAutomatedTest
  ? 'simulator'
  : env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
    ? 'razorpay'
    : isProduction
      ? 'off'
      : 'simulator';

export const nearbyConfig = {
  enabled: env.NEARBY_ENABLED,
  radiusMeters: env.NEARBY_RADIUS_METERS,
  minEncounterSeconds: env.NEARBY_MIN_ENCOUNTER_DURATION_SECONDS,
  accuracyLimitMeters: env.NEARBY_LOCATION_ACCURACY_LIMIT_METERS,
  sampleSeconds: env.NEARBY_LOCATION_SAMPLE_SECONDS,
  encounterCooldownMinutes: env.NEARBY_ENCOUNTER_COOLDOWN_MINUTES,
  notificationCooldownMinutes: env.NEARBY_NOTIFICATION_COOLDOWN_MINUTES,
  maxPushesPerDay: env.NEARBY_MAX_PUSHES_PER_DAY,
  retentionDays: env.NEARBY_ENCOUNTER_RETENTION_DAYS,
} as const;
