import { ApiError } from '../../utils/ApiError';
import type { PlanId, UserDoc } from '../users/user.model';
import { entitlementOf } from '../subscriptions/entitlement.service';
import { type Period, PERIOD_MONTHS, periodMs, PLANS, refreshPlans } from '../subscriptions/plans';
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

export type QuoteKind = 'new' | 'renew' | 'upgrade';

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

/**
 * Unused value of the current Razorpay period, rounded down to the rupee. Only paid
 * time counts (a gifted / test plan gives no credit).
 */
export function upgradeCredit(user: UserDoc, now = new Date()) {
  const e = user.entitlement;
  if (!e || e.source !== 'razorpay' || !e.paid_paise || !e.expires_at || !e.period_started_at) {
    return 0;
  }
  const total = e.expires_at.getTime() - e.period_started_at.getTime();
  const left = e.expires_at.getTime() - now.getTime();
  if (total <= 0 || left <= 0) return 0;
  const raw = Math.floor((e.paid_paise * Math.min(left, total)) / total);
  return raw - (raw % 100);
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

  let kind: QuoteKind = 'new';
  let startsAt = now;
  let credit = 0;
  if (ent.status === 'active') {
    if (plan.rank < current.rank) {
      throw ApiError.conflict(
        `You're on ${current.name} until ${ent.expires_at?.toISOString().slice(0, 10)}. You can switch to ${plan.name} after it ends.`,
        'PLAN_DOWNGRADE_LATER',
        { current_plan: current.id, current_period_end: ent.expires_at?.toISOString() ?? null },
      );
    }
    if (plan.rank === current.rank) {
      if (stored?.source === 'razorpay' && stored.autopay && !stored.cancel_at_period_end) {
        throw ApiError.conflict(
          `You're already on ${plan.name} with AutoPay.`,
          'ALREADY_ON_PLAN',
        );
      }
      // Paying again for the same plan adds a period after the current one.
      kind = 'renew';
      startsAt = ent.expires_at && ent.expires_at > now ? ent.expires_at : now;
    } else {
      kind = 'upgrade';
      credit = upgradeCredit(user, now);
    }
  }

  const months = PERIOD_MONTHS[input.period];
  const base = plan.pricing[input.period];
  const monthlyTotal = plan.pricing.monthly * months;
  const mrp = Math.max(plan.mrp_inr * 100 * months, monthlyTotal);
  const coupon = input.coupon_code
    ? await checkCoupon(user, input.coupon_code, plan.id, input.period, now)
    : null;
  const couponOff = coupon ? Math.floor((base * coupon.pct) / 100) : 0;
  const amount = Math.max(100, base - couponOff - credit);
  const endsAt = new Date(startsAt.getTime() + periodMs(input.period));

  return {
    plan_id: plan.id,
    period: input.period,
    months,
    autopay: input.autopay,
    kind,
    mrp_paise: mrp,
    base_paise: base,
    launch_off_paise: mrp - monthlyTotal,
    period_off_paise: monthlyTotal - base,
    coupon: coupon
      ? { code: coupon.code, pct: coupon.pct, off_paise: couponOff, note: coupon.note }
      : null,
    credit_paise: Math.max(0, Math.min(credit, base - couponOff - 100)),
    amount_paise: amount,
    renewal_paise: input.autopay ? base : null,
    starts_at: startsAt,
    ends_at: endsAt,
    currency: 'INR',
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
