import { ApiError } from '../../utils/ApiError';
import type { PlanId, UserDoc } from '../users/user.model';
import { entitlementOf } from '../subscriptions/entitlement.service';
import { type Period, PERIOD_MONTHS, periodMs, PLANS, refreshPlans } from '../subscriptions/plans';
import { consumedWholeDays, creditToDays, DAY_MS, spanDays, unusedCredit, upgradePayable } from './billing';
import { CouponRedemption, Payment } from './payment.models';

type Coupon = {
  pct: number;
  note: string;
  plans?: PlanId[];
  periods?: Period[];
  first_purchase_only?: boolean;
  max_redemptions?: number;
  starts_at?: Date;
  ends_at?: Date;
};

/** Server-side coupons (razorpay-payments.md §2). First billing period only. */
export const COUPONS: Record<string, Coupon> = {
  NEXITY20: { pct: 20, note: '20% off your first period' },
  WELCOME50: { pct: 50, note: '50% off your first subscription', first_purchase_only: true },
};

export type QuoteKind = 'new' | 'renew' | 'upgrade' | 'downgrade';

export type Quote = {
  plan_id: PlanId;
  period: Period;
  months: number;
  autopay: boolean;
  kind: QuoteKind;
  mrp_paise: number;
  base_paise: number;
  launch_off_paise: number;
  period_off_paise: number;
  coupon: { code: string; pct: number; off_paise: number; note: string } | null;
  credit_paise: number;
  amount_paise: number;
  renewal_paise: number | null;
  starts_at: Date;
  ends_at: Date;
  currency: 'INR';
  /** Whole days of the current paid period already used. 0 when this quote is not a plan change. */
  consumed_days: number;
  period_days: number;
  consumed_paise: number;
  unused_paise: number;
  /** Days granted on a downgrade (nearest whole day). 0 for a new purchase or an upgrade that still needs payment. */
  extra_days: number;
  /** Paise of plan value created or removed by nearest-day rounding. Positive means the user receives slightly more. */
  rounding_adjustment_paise: number;
  /** Paise added so a tiny upgrade still meets Razorpay's ₹1 minimum. */
  gateway_topup_paise: number;
  target_period_days: number;
};

const couponError = (code: string, message: string) => ApiError.badRequest(message, undefined, code);

async function checkCoupon(user: UserDoc, raw: string, planId: PlanId, period: Period, now: Date) {
  const code = raw.trim().toUpperCase();
  const c = COUPONS[code];
  if (!c) throw couponError('COUPON_INVALID', "That code isn't valid or has expired.");
  if ((c.starts_at && c.starts_at > now) || (c.ends_at && c.ends_at <= now)) {
    throw couponError('COUPON_EXPIRED', "That code isn't valid or has expired.");
  }
  if ((c.plans && !c.plans.includes(planId)) || (c.periods && !c.periods.includes(period))) {
    throw couponError('COUPON_NOT_FOR_PLAN', "This code can't be used for this plan.");
  }
  if (c.first_purchase_only && (await Payment.exists({ user_id: user._id }))) {
    throw couponError('COUPON_FIRST_PURCHASE_ONLY', 'This code is only for your first subscription.');
  }
  if (await CouponRedemption.exists({ code, user_id: user._id })) {
    throw couponError('COUPON_LIMIT_REACHED', "You've already used this code.");
  }
  if (c.max_redemptions && (await CouponRedemption.countDocuments({ code })) >= c.max_redemptions) {
    throw couponError('COUPON_LIMIT_REACHED', 'This code has been fully used.');
  }
  return { code, ...c };
}

/** Paid Razorpay time that can be converted once. Gifted and dev plans have no cash value. */
export function paidWindow(user: UserDoc, now = new Date()) {
  const e = user.entitlement;
  if (!e || e.source !== 'razorpay' || !e.paid_paise || !e.expires_at || !e.period_started_at) return null;
  if (e.expires_at.getTime() <= now.getTime()) return null;
  const periodDays = spanDays(e.period_started_at, e.expires_at);
  const consumedDays = consumedWholeDays(e.period_started_at, now, periodDays);
  const credit = unusedCredit(e.paid_paise, periodDays, consumedDays);
  return {
    periodDays,
    consumedDays,
    consumedPaise: credit.consumedPaise,
    unusedPaise: credit.unusedPaise,
    pricePaise: e.price_paise ?? e.paid_paise,
  };
}

/** The only place prices are computed (razorpay-payments.md §2). */
export async function computeQuote(
  user: UserDoc,
  input: { plan_id: PlanId; period: Period; autopay: boolean; coupon_code?: string | null },
  now = new Date(),
): Promise<Quote> {
  await refreshPlans();
  const plan = PLANS[input.plan_id];
  if (!plan || plan.id === 'free') {
    throw ApiError.badRequest('That plan is not available.', undefined, 'PLAN_NOT_AVAILABLE');
  }
  const ent = entitlementOf(user, now);
  const current = PLANS[ent.plan];
  const stored = user.entitlement;

  const months = PERIOD_MONTHS[input.period];
  const base = plan.pricing[input.period];
  const window = ent.status === 'active' ? paidWindow(user, now) : null;
  // Same period length (monthly→monthly) uses the subscription's real span, so a 31-day
  // October period is not treated as 30 days. A different period uses the plan's own length.
  const configuredTargetDays = months * 30;
  const targetPeriodDays =
    window && stored?.period === input.period ? window.periodDays : configuredTargetDays;
  const currentPrice = window?.pricePaise ?? 0;

  let kind: QuoteKind = 'new';
  let startsAt = now;
  let consumedDays = 0;
  let periodDays = 0;
  let consumedPaise = 0;
  let unusedPaise = 0;
  let extraDays = 0;
  let roundingAdjustment = 0;
  let credit = 0;
  let gatewayTopup = 0;
  let amount = 0;
  let coupon: Awaited<ReturnType<typeof checkCoupon>> | null = null;

  const sameSelection = ent.status === 'active' && plan.id === current.id && stored?.period === input.period;

  if (sameSelection) {
    if (stored?.source === 'razorpay' && stored.autopay && !stored.cancel_at_period_end) {
      throw ApiError.conflict(`You're already on ${plan.name} with AutoPay.`, 'ALREADY_ON_PLAN');
    }
    kind = 'renew';
    startsAt = ent.expires_at && ent.expires_at > now ? ent.expires_at : now;
  } else if (window && currentPrice > 0 && base < currentPrice) {
    kind = 'downgrade';
    consumedDays = window.consumedDays;
    periodDays = window.periodDays;
    consumedPaise = window.consumedPaise;
    unusedPaise = window.unusedPaise;
    const converted = creditToDays(unusedPaise, base, targetPeriodDays);
    extraDays = converted.extraDays;
    roundingAdjustment = converted.roundingAdjustmentPaise;
    credit = unusedPaise;
    if (extraDays < 1) {
      throw ApiError.conflict(
        'This period has no unused value left to move onto a lower plan.',
        'NO_UNUSED_CREDIT',
      );
    }
    amount = 0;
  } else if (window && currentPrice > 0 && base > currentPrice) {
    kind = 'upgrade';
    consumedDays = window.consumedDays;
    periodDays = window.periodDays;
    consumedPaise = window.consumedPaise;
    unusedPaise = window.unusedPaise;
  } else if (ent.status === 'active' && plan.rank > current.rank) {
    kind = 'upgrade';
    if (window) {
      consumedDays = window.consumedDays;
      periodDays = window.periodDays;
      consumedPaise = window.consumedPaise;
      unusedPaise = window.unusedPaise;
    }
  }

  if (kind !== 'downgrade') {
    coupon = input.coupon_code ? await checkCoupon(user, input.coupon_code, plan.id, input.period, now) : null;
    const couponOff = coupon ? Math.floor((base * coupon.pct) / 100) : 0;
    if (kind === 'upgrade') {
      const priced = upgradePayable(unusedPaise, base, couponOff);
      credit = priced.creditPaise;
      amount = priced.payablePaise;
      gatewayTopup = priced.gatewayTopupPaise;
      if (priced.leftoverPaise > 0 && amount === 0) {
        const converted = creditToDays(priced.leftoverPaise, base, targetPeriodDays);
        extraDays = converted.extraDays;
        roundingAdjustment = converted.roundingAdjustmentPaise;
      }
    } else {
      amount = Math.max(100, base - couponOff);
    }
  }

  const endsAt =
    kind === 'downgrade'
      ? new Date(now.getTime() + extraDays * DAY_MS)
      : new Date(startsAt.getTime() + periodMs(input.period) + extraDays * DAY_MS);
  const monthlyTotal = plan.pricing.monthly * months;
  const mrp = Math.max(plan.mrp_inr * 100 * months, monthlyTotal);
  const couponOff = coupon ? Math.floor((base * coupon.pct) / 100) : 0;

  return {
    plan_id: plan.id,
    period: input.period,
    months,
    autopay: kind === 'downgrade' ? false : input.autopay,
    kind,
    mrp_paise: mrp,
    base_paise: base,
    launch_off_paise: mrp - monthlyTotal,
    period_off_paise: monthlyTotal - base,
    coupon: coupon
      ? { code: coupon.code, pct: coupon.pct, off_paise: couponOff, note: coupon.note }
      : null,
    credit_paise: credit,
    amount_paise: amount,
    renewal_paise: kind === 'downgrade' ? null : input.autopay ? base : null,
    starts_at: startsAt,
    ends_at: endsAt,
    currency: 'INR',
    consumed_days: consumedDays,
    period_days: periodDays,
    consumed_paise: consumedPaise,
    unused_paise: unusedPaise,
    extra_days: extraDays,
    rounding_adjustment_paise: roundingAdjustment,
    gateway_topup_paise: gatewayTopup,
    target_period_days: targetPeriodDays,
  };
}

export function quoteDto(q: Quote) {
  return {
    ...q,
    starts_at: q.starts_at.toISOString(),
    ends_at: q.ends_at.toISOString(),
    renews_on: q.autopay ? q.ends_at.toISOString() : null,
  };
}
