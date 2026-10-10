import mongoose, { type Types } from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import type { PlanId, UserDoc } from '../users/user.model';
import { type Plan, PLANS } from './plans';
import { SecretUsage } from './usage.model';

const MONGO_DUPLICATE_KEY = 11000;
/** Usage months and fair-use days follow India time (UTC+05:30, no DST). */
const IST_OFFSET_MS = 330 * 60_000;

export type Entitlement = {
  plan: PlanId;
  status: 'none' | 'active';
  expires_at: Date | null;
  limits: Plan['limits'];
};

type EntitlementSource = Pick<UserDoc, 'entitlement'>;

/** The plan in force right now. A stale cache past `expires_at` counts as Free. */
export function entitlementOf(user: EntitlementSource, now = new Date()): Entitlement {
  const cached = user.entitlement;
  const plan = (cached?.plan ?? 'free') as PlanId;
  const expiresAt = cached?.expires_at ?? null;
  const active = plan !== 'free' && (!expiresAt || expiresAt > now);
  const effective: PlanId = active ? plan : 'free';
  return {
    plan: effective,
    status: active ? 'active' : 'none',
    expires_at: active ? expiresAt : null,
    limits: PLANS[effective].limits,
  };
}

function istParts(now: Date) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function monthPeriod(now = new Date()) {
  const { y, m } = istParts(now);
  return `m:${y}-${pad(m + 1)}`;
}

export function dayPeriod(now = new Date()) {
  const { y, m, d } = istParts(now);
  return `d:${y}-${pad(m + 1)}-${pad(d)}`;
}

/** 00:00 IST on the 1st of next month. */
export function monthResetsAt(now = new Date()) {
  const { y, m } = istParts(now);
  return new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET_MS);
}

/** 00:00 IST today. */
export function dayStartsAt(now = new Date()) {
  const { y, m, d } = istParts(now);
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

function dayResetsAt(now = new Date()) {
  const { y, m, d } = istParts(now);
  return new Date(Date.UTC(y, m, d + 1) - IST_OFFSET_MS);
}

async function usedIn(userId: Types.ObjectId, period: string) {
  const row = await SecretUsage.findOne({ user_id: userId, period }).lean();
  return row?.count ?? 0;
}

/** Conditional `$inc` on a pre-created row, so parallel sends can never pass the limit. */
async function reserve(userId: Types.ObjectId, period: string, limit: number) {
  try {
    await SecretUsage.updateOne(
      { user_id: userId, period },
      { $setOnInsert: { count: 0 } },
      { upsert: true },
    );
  } catch (err) {
    if (!(err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY)) {
      throw err;
    }
  }
  const row = await SecretUsage.findOneAndUpdate(
    { user_id: userId, period, count: { $lt: limit } },
    { $inc: { count: 1 } },
    { returnDocument: 'after' },
  );
  return Boolean(row);
}

async function release(userId: Types.ObjectId, period: string) {
  await SecretUsage.updateOne(
    { user_id: userId, period, count: { $gt: 0 } },
    { $inc: { count: -1 } },
  );
}

export function planRequired(feature: string) {
  return ApiError.forbidden('This needs a Plus or Premium plan.', 'PLAN_REQUIRED', {
    feature,
    required_plan: 'plus',
  });
}

/**
 * Takes one new-thread slot from the month (and the fair-use day). Returns a refund
 * to call when the send fails afterwards.
 */
export async function reserveSecretMessage(user: UserDoc, now = new Date()) {
  const { limits } = entitlementOf(user, now);
  const monthly = limits.secret_messages_per_month;
  if (monthly === 0) throw planRequired('send_secret');

  const day = dayPeriod(now);
  const daily = limits.secret_messages_per_day_fair_use;
  if (daily > 0 && !(await reserve(user._id, day, daily))) {
    throw ApiError.forbidden("You've sent a lot today. Try again tomorrow.", 'PLAN_LIMIT_REACHED', {
      limit: daily,
      scope: 'day',
      resets_at: dayResetsAt(now).toISOString(),
    });
  }

  const month = monthPeriod(now);
  if (monthly > 0 && !(await reserve(user._id, month, monthly))) {
    if (daily > 0) await release(user._id, day);
    throw ApiError.forbidden(
      `You've used all ${monthly} Secret Messages this month.`,
      'PLAN_LIMIT_REACHED',
      { limit: monthly, scope: 'month', resets_at: monthResetsAt(now).toISOString() },
    );
  }

  return async () => {
    await Promise.all([
      daily > 0 ? release(user._id, day) : undefined,
      monthly > 0 ? release(user._id, month) : undefined,
    ]);
  };
}

/** `left` is null when unlimited. */
export async function secretUsage(user: UserDoc, now = new Date()) {
  const { limits } = entitlementOf(user, now);
  const used = await usedIn(user._id, monthPeriod(now));
  const limit = limits.secret_messages_per_month;
  return {
    secret_messages_this_month: used,
    secret_messages_limit: limit < 0 ? null : limit,
    secret_messages_left: limit < 0 ? null : Math.max(0, limit - used),
    month_resets_at: monthResetsAt(now).toISOString(),
  };
}

export async function subscriptionDto(user: UserDoc) {
  const ent = entitlementOf(user);
  const e = user.entitlement;
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return {
    plan: ent.plan,
    status: ent.status,
    current_period_end: ent.expires_at ? ent.expires_at.toISOString() : null,
    limits: ent.limits,
    usage: await secretUsage(user),
    billing:
      ent.status === 'active' && e
        ? {
            source: e.source ?? null,
            period: e.period ?? null,
            autopay: Boolean(e.autopay),
            cancel_at_period_end: Boolean(e.cancel_at_period_end),
            status: e.billing_status ?? (e.source === 'razorpay' ? 'active' : null),
            next_charge_at: e.autopay ? iso(e.next_charge_at) : null,
            price_paise: e.price_paise ?? null,
            method_display: e.method_display ?? null,
          }
        : null,
  };
}
