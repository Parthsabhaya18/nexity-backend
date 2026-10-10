import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';

import { env, paymentsMode } from '../../config/env';
import { emitToUser } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { notifySystem } from '../notifications/notification.service';
import type { NotificationType } from '../notifications/notification.model';
import { syncCrushes } from '../secret-crush/crush.service';
import { entitlementOf, subscriptionDto } from '../subscriptions/entitlement.service';
import { type Period, PERIOD_MONTHS, periodMs, PLANS } from '../subscriptions/plans';
import { type PlanId, User, type UserDoc } from '../users/user.model';
import {
  type CheckoutDoc,
  CouponRedemption,
  Payment,
  PaymentCheckout,
  PaymentWebhookEvent,
  RazorpayPlan,
} from './payment.models';
import { computeQuote } from './quote';
import {
  gateway,
  hmacHex,
  isTestKey,
  keyId,
  methodDisplay,
  orderSignature,
  type RzpPayment,
  type RzpSubscription,
  safeEqualHex,
  simulatePayment,
  type SimMethod,
  subscriptionSignature,
  webhookSecret,
} from './razorpay.gateway';

const MONGO_DUPLICATE_KEY = 11000;
const CHECKOUT_TTL_MS = 15 * 60_000;
const PENDING_GIVE_UP_MS = 30 * 60_000;
const GRACE_MS = 3 * 86_400_000;
const POLL_THROTTLE_MS = env.NODE_ENV === 'test' ? 0 : 2_000;
/** ≈ 10 years of renewals; cancel anytime. */
const TOTAL_COUNT: Record<Period, number> = { monthly: 120, quarterly: 40, yearly: 10 };

export const PAYMENT_METHODS = ['upi', 'qr', 'card', 'netbanking', 'wallet'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** QR and wallets can't set up a mandate. */
const ONE_TIME_ONLY: ReadonlySet<PaymentMethod> = new Set(['qr', 'wallet']);

const isDuplicate = (err: unknown) =>
  err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY;

const PERIOD_LABEL: Record<Period, string> = {
  monthly: 'Monthly',
  quarterly: '3 months',
  yearly: 'Yearly',
};

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const day = (d: Date) =>
  d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

/* ---------- Platform / availability ---------- */

/** Android and iOS both use Razorpay. Unknown platforms stay blocked. */
export function assertPaymentsAvailable(platform: string | undefined) {
  if (paymentsMode === 'off') {
    throw new ApiError(503, 'Payments are not available right now.', undefined, 'PAYMENTS_UNAVAILABLE');
  }
  const p = (platform ?? 'android').toLowerCase();
  if (!env.PAYMENTS_ENABLED_PLATFORMS.includes(p)) {
    throw ApiError.forbidden(
      'Payments are not available on this device.',
      'PAYMENT_PROVIDER_NOT_AVAILABLE',
    );
  }
}

export function paymentsInfo() {
  return {
    provider: 'razorpay' as const,
    mode: paymentsMode === 'razorpay' ? (isTestKey() ? 'test' : 'live') : paymentsMode,
    methods: PAYMENT_METHODS,
    one_time_only_methods: [...ONE_TIME_ONLY],
  };
}

export function catalog() {
  return (Object.values(PLANS))
    .filter((p) => p.active)
    .sort((a, b) => a.rank - b.rank)
    .map((p) => {
    const pricing = Object.fromEntries(
      (['monthly', 'quarterly', 'yearly'] as const).map((period) => {
        const amount = p.pricing[period];
        const months = PERIOD_MONTHS[period];
        const full = p.pricing.monthly * months;
        return [
          period,
          {
            amount_paise: amount,
            months,
            per_month_paise: Math.floor(amount / months),
            save_pct: full > 0 ? Math.round((1 - amount / full) * 100) : 0,
          },
        ];
      }),
    );
    return { ...p, pricing, mrp_paise: p.mrp_inr * 100 };
  });
}

/* ---------- Quote & checkout ---------- */

export type CheckoutInput = {
  plan_id: PlanId;
  period: Period;
  autopay: boolean;
  coupon_code?: string | null;
  method?: PaymentMethod | null;
};

export async function quote(user: UserDoc, input: CheckoutInput) {
  if (input.autopay && input.method && ONE_TIME_ONLY.has(input.method)) {
    throw ApiError.badRequest(
      'QR and wallets are for one-time payments. Turn off AutoPay or pick another method.',
      undefined,
      'METHOD_NOT_FOR_AUTOPAY',
    );
  }
  return computeQuote(user, input);
}

/** Razorpay plan entity for plan × period, created once and checked against our price. */
async function razorpayPlanId(planId: PlanId, period: Period) {
  const amount = PLANS[planId].pricing[period];
  const key = `${planId}.${period}`;
  const found = await RazorpayPlan.findOne({ key, mode: paymentsMode, amount_paise: amount }).lean();
  if (found) return found.razorpay_plan_id;
  const created = await gateway.createPlan({
    period: period === 'yearly' ? 'yearly' : 'monthly',
    interval: period === 'quarterly' ? 3 : 1,
    name: `Nexity ${PLANS[planId].name} · ${PERIOD_LABEL[period]}`,
    amount,
  });
  if (created.item.amount !== amount) {
    logger.error({ key, amount, got: created.item.amount }, 'RAZORPAY_PLAN_MISMATCH');
    throw new ApiError(502, 'Plan price mismatch.', undefined, 'PAYMENT_PROVIDER_ERROR');
  }
  try {
    await RazorpayPlan.create({ key, mode: paymentsMode, amount_paise: amount, razorpay_plan_id: created.id });
    return created.id;
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const row = await RazorpayPlan.findOne({ key, mode: paymentsMode, amount_paise: amount }).lean();
    return row!.razorpay_plan_id;
  }
}

function maskEmail(email: string) {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

export function checkoutDto(c: CheckoutDoc, user: UserDoc) {
  const plan = PLANS[c.plan_id as PlanId];
  const q = c.quote!;
  return {
    checkout_id: c.public_id,
    type: c.type,
    status: c.status,
    plan_id: c.plan_id,
    period: c.period,
    autopay: c.autopay,
    method: c.method,
    amount_paise: c.amount_paise,
    expires_at: c.expires_at.toISOString(),
    quote: {
      plan_id: c.plan_id,
      period: c.period,
      months: q.months,
      autopay: c.autopay,
      kind: c.kind,
      mrp_paise: q.mrp_paise,
      base_paise: q.base_paise,
      launch_off_paise: q.launch_off_paise,
      period_off_paise: q.period_off_paise,
      coupon: q.coupon_code
        ? { code: q.coupon_code, pct: q.coupon_pct, off_paise: q.coupon_off_paise }
        : null,
      credit_paise: q.credit_paise,
      amount_paise: q.amount_paise,
      renewal_paise: q.renewal_paise,
      starts_at: q.starts_at?.toISOString() ?? null,
      ends_at: q.ends_at?.toISOString() ?? null,
      renews_on: c.autopay ? (q.ends_at?.toISOString() ?? null) : null,
      currency: 'INR',
    },
    razorpay: {
      key_id: keyId(),
      order_id: c.razorpay_order_id,
      subscription_id: c.razorpay_subscription_id,
      amount: c.amount_paise,
      currency: 'INR',
      name: 'Nexity',
      description: `Nexity ${plan.name} · ${PERIOD_LABEL[c.period as Period]}`,
      logo_url: env.RAZORPAY_LOGO_URL ?? null,
      prefill: { email: user.email, contact: '', method: c.method === 'qr' ? 'upi' : c.method },
      email_hint: maskEmail(user.email),
    },
    simulator: paymentsMode === 'simulator',
  };
}

export async function createCheckout(
  user: UserDoc,
  input: CheckoutInput,
  idempotencyKey: string,
  platform: string | undefined,
) {
  const existing = await PaymentCheckout.findOne({ user_id: user._id, idempotency_key: idempotencyKey });
  if (existing) return checkoutDto(existing, user);

  const now = new Date();
  const inFlight = await PaymentCheckout.findOne({ user_id: user._id, status: 'pending' });
  if (inFlight && now.getTime() - inFlight.updated_at.getTime() < PENDING_GIVE_UP_MS) {
    throw ApiError.conflict(
      'A payment is still being confirmed. Wait a moment before paying again.',
      'CHECKOUT_IN_PROGRESS',
      { checkout_id: inFlight.public_id },
    );
  }

  const q = await quote(user, input);
  // An unpaid earlier attempt (sheet closed) is replaced. If it still gets paid, the payment is honoured.
  await PaymentCheckout.updateMany(
    { user_id: user._id, status: 'created' },
    { $set: { status: 'cancelled', failure_reason: 'replaced' } },
  );

  const type = input.autopay ? 'subscription' : 'order';
  let c: CheckoutDoc;
  try {
    c = await PaymentCheckout.create({
      public_id: randomUUID(),
      user_id: user._id,
      plan_id: q.plan_id,
      period: q.period,
      type,
      autopay: input.autopay,
      method: input.method ?? null,
      kind: q.kind,
      quote: {
        months: q.months,
        mrp_paise: q.mrp_paise,
        base_paise: q.base_paise,
        launch_off_paise: q.launch_off_paise,
        period_off_paise: q.period_off_paise,
        coupon_code: q.coupon?.code ?? null,
        coupon_pct: q.coupon?.pct ?? null,
        coupon_off_paise: q.coupon?.off_paise ?? 0,
        credit_paise: q.credit_paise,
        amount_paise: q.amount_paise,
        renewal_paise: q.renewal_paise,
        starts_at: q.starts_at,
        ends_at: q.ends_at,
      },
      amount_paise: q.amount_paise,
      idempotency_key: idempotencyKey,
      expires_at: new Date(now.getTime() + CHECKOUT_TTL_MS),
      platform: platform ?? null,
    });
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const row = await PaymentCheckout.findOne({ user_id: user._id, idempotency_key: idempotencyKey });
    return checkoutDto(row!, user);
  }

  const notes = {
    checkout_id: c.public_id,
    user_id: user.id as string,
    plan: q.plan_id,
    period: q.period,
  };
  try {
    if (type === 'order') {
      const order = await gateway.createOrder({
        amount: q.amount_paise,
        receipt: c.public_id.replace(/-/g, '').slice(0, 40),
        notes,
      });
      c.razorpay_order_id = order.id;
    } else {
      const planId = await razorpayPlanId(q.plan_id, q.period);
      const sub = await gateway.createSubscription({
        planId,
        totalCount: TOTAL_COUNT[q.period],
        startAt: q.ends_at,
        upfrontPaise: q.amount_paise,
        upfrontName: `Nexity ${PLANS[q.plan_id].name} · first ${PERIOD_LABEL[q.period].toLowerCase()}`,
        notes,
      });
      c.razorpay_subscription_id = sub.id;
      c.razorpay_plan_id = planId;
    }
    await c.save();
  } catch (err) {
    c.status = 'failed';
    c.failure_reason = 'provider_error';
    await c.save();
    throw err;
  }
  return checkoutDto(c, user);
}

/* ---------- Activation (the only writer of Razorpay entitlements) ---------- */

function emitSubscription(user: UserDoc) {
  void subscriptionDto(user).then((dto) => emitToUser(user.id as string, 'subscription.updated', dto));
}

async function notify(userId: mongoose.Types.ObjectId, type: NotificationType, text: string) {
  await notifySystem({ recipientId: userId, type, text }).catch((err: unknown) =>
    logger.warn({ err, type }, 'Payment notification failed'),
  );
}

async function activate(c: CheckoutDoc, payment: RzpPayment) {
  const user = await User.findById(c.user_id);
  if (!user) return;
  const now = new Date();
  const ent = entitlementOf(user, now);
  const stored = user.entitlement;
  const samePlanActive = ent.status === 'active' && ent.plan === c.plan_id;
  const start = samePlanActive && ent.expires_at && ent.expires_at > now ? ent.expires_at : now;
  const end = new Date(start.getTime() + periodMs(c.period as Period));
  const oldSubscription =
    stored?.razorpay_subscription_id && stored.razorpay_subscription_id !== c.razorpay_subscription_id
      ? stored.razorpay_subscription_id
      : null;
  // Stacking keeps the paid rate correct for a later upgrade credit.
  const stacking = samePlanActive && stored?.source === 'razorpay' && stored.period_started_at;
  user.set('entitlement', {
    plan: c.plan_id,
    expires_at: end,
    source: 'razorpay',
    updated_at: now,
    period: c.period,
    autopay: c.autopay,
    razorpay_subscription_id: c.autopay ? c.razorpay_subscription_id : null,
    price_paise: c.quote!.base_paise,
    paid_paise: stacking ? (stored.paid_paise ?? 0) + payment.amount : payment.amount,
    period_started_at: stacking ? stored.period_started_at : start,
    next_charge_at: c.autopay ? end : null,
    cancel_at_period_end: false,
    billing_status: 'active',
    method_display: methodDisplay(payment),
    reminded: null,
  });
  await user.save();
  await Payment.updateOne(
    { razorpay_payment_id: payment.id },
    { $set: { period_start: start, period_end: end } },
  );
  await syncCrushes(user);

  if (oldSubscription) {
    await gateway
      .cancelSubscription(oldSubscription, false)
      .catch((err: unknown) => logger.warn({ err }, 'Old AutoPay subscription cancel failed'));
  }
  if (c.quote?.coupon_code) {
    await CouponRedemption.create({
      code: c.quote.coupon_code,
      user_id: user._id,
      checkout_id: c._id,
      used_at: now,
    }).catch((err: unknown) => {
      if (!isDuplicate(err)) throw err;
    });
  }
  const plan = PLANS[c.plan_id as PlanId];
  await notify(
    user._id,
    'subscription_activated',
    `Payment successful — your ${plan.name} plan is active until ${day(end)} 🎉`,
  );
  emitSubscription(user);
}

type Outcome = 'paid' | 'pending' | 'failed' | 'amount_mismatch';

async function markFailed(c: CheckoutDoc, reason: string | null | undefined) {
  await PaymentCheckout.updateOne(
    { _id: c._id, status: { $in: ['created', 'pending'] } },
    { $set: { status: 'failed', failure_reason: reason ?? 'Payment failed' } },
  );
}

/**
 * The §4 amount-integrity checks. Runs for /verify, webhooks, polling and the cleanup job,
 * so whichever arrives first activates the plan exactly once.
 */
async function finalize(
  c: CheckoutDoc,
  p: RzpPayment,
  via: { subscriptionId?: string; qrId?: string } = {},
): Promise<Outcome> {
  if (c.status === 'paid') return 'paid';
  if (c.status === 'amount_mismatch') return 'amount_mismatch';

  const used = await Payment.findOne({ razorpay_payment_id: p.id }).lean();
  if (used) {
    if (used.checkout_id?.equals(c._id)) return 'paid';
    throw ApiError.conflict('This payment was already used.', 'PAYMENT_ALREADY_USED');
  }
  if (p.status === 'failed') {
    await markFailed(c, p.error_description);
    return 'failed';
  }
  if (p.status !== 'captured') {
    await PaymentCheckout.updateOne({ _id: c._id, status: 'created' }, { $set: { status: 'pending' } });
    return 'pending';
  }

  // The payment must be the one Razorpay attached to this order, QR or subscription.
  // A signed webhook that names a different payment is refused.
  let linked = false;
  if (c.type === 'order' && via.qrId) {
    const onQr = (await gateway.qrPayments(via.qrId)).some((row) => row.id === p.id);
    linked = via.qrId === c.razorpay_qr_id && onQr;
  } else if (c.type === 'order') {
    linked = p.order_id === c.razorpay_order_id;
  } else if (c.razorpay_subscription_id) {
    const onSub = (await gateway.subscriptionPayments(c.razorpay_subscription_id)).some((row) => row.id === p.id);
    linked = onSub && (!via.subscriptionId || via.subscriptionId === c.razorpay_subscription_id);
  }
  if (!linked) {
    throw ApiError.badRequest('This payment is not for this checkout.', undefined, 'PAYMENT_MISMATCH');
  }
  if (p.currency !== 'INR' || p.amount !== c.amount_paise) {
    logger.error(
      { checkout: c.public_id, expected: c.amount_paise, got: p.amount, payment: p.id },
      'Payment amount mismatch — refunding',
    );
    await PaymentCheckout.updateOne(
      { _id: c._id, status: { $ne: 'paid' } },
      { $set: { status: 'amount_mismatch', failure_reason: 'amount_mismatch' } },
    );
    await gateway
      .refund(p.id)
      .catch((err: unknown) => logger.error({ err, payment: p.id }, 'Mismatch refund failed'));
    return 'amount_mismatch';
  }

  // The atomic claim makes parallel /verify, webhook and polling activate exactly once.
  const claimed = await PaymentCheckout.findOneAndUpdate(
    { _id: c._id, status: { $nin: ['paid', 'amount_mismatch'] } },
    { $set: { status: 'paid', paid_at: new Date(), failure_reason: null } },
    { returnDocument: 'after' },
  );
  if (!claimed) return 'paid';
  try {
    await Payment.create({
      razorpay_payment_id: p.id,
      user_id: c.user_id,
      checkout_id: c._id,
      razorpay_subscription_id: c.razorpay_subscription_id,
      plan_id: c.plan_id,
      period: c.period,
      kind: c.kind === 'upgrade' ? 'upgrade' : c.autopay ? 'first' : 'one_time',
      amount_paise: p.amount,
      method: p.method,
      method_display: methodDisplay(p),
    });
  } catch (err) {
    if (!isDuplicate(err)) throw err;
  }
  await activate(claimed, p);
  return 'paid';
}

/** AutoPay turned back on: nothing charged today, only the mandate. */
async function finalizeMandate(c: CheckoutDoc, sub: RzpSubscription): Promise<Outcome> {
  if (c.status === 'paid') return 'paid';
  if (sub.plan_id !== c.razorpay_plan_id || !['authenticated', 'active'].includes(sub.status)) {
    return 'pending';
  }
  const claimed = await PaymentCheckout.findOneAndUpdate(
    { _id: c._id, status: { $in: ['created', 'pending', 'failed', 'cancelled', 'expired'] } },
    { $set: { status: 'paid', paid_at: new Date() } },
    { returnDocument: 'after' },
  );
  if (!claimed) return 'paid';
  const user = await User.findById(c.user_id);
  if (!user) return 'paid';
  const ent = user.entitlement;
  if (ent && ent.plan === c.plan_id && ent.expires_at && ent.expires_at > new Date()) {
    user.set('entitlement.autopay', true);
    user.set('entitlement.razorpay_subscription_id', c.razorpay_subscription_id);
    user.set('entitlement.cancel_at_period_end', false);
    user.set('entitlement.billing_status', 'active');
    user.set('entitlement.next_charge_at', ent.expires_at);
    user.set('entitlement.price_paise', c.quote!.base_paise);
    await user.save();
    await notify(
      user._id,
      'subscription_activated',
      `AutoPay is on — ${PLANS[c.plan_id as PlanId].name} renews on ${day(ent.expires_at)}.`,
    );
    emitSubscription(user);
  }
  return 'paid';
}

/* ---------- Verify / status / QR ---------- */

async function ownCheckout(user: UserDoc, checkoutId: string) {
  const c = await PaymentCheckout.findOne({ public_id: checkoutId, user_id: user._id });
  if (!c) throw ApiError.notFound('That payment was not found.');
  return c;
}

export async function verify(
  user: UserDoc,
  body: {
    checkout_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    razorpay_order_id?: string;
    razorpay_subscription_id?: string;
  },
) {
  const c = await ownCheckout(user, body.checkout_id);
  if (c.status !== 'paid') {
    const signed =
      c.type === 'order'
        ? body.razorpay_order_id === c.razorpay_order_id &&
          safeEqualHex(orderSignature(c.razorpay_order_id!, body.razorpay_payment_id), body.razorpay_signature)
        : (!body.razorpay_subscription_id ||
            body.razorpay_subscription_id === c.razorpay_subscription_id) &&
          safeEqualHex(
            subscriptionSignature(body.razorpay_payment_id, c.razorpay_subscription_id!),
            body.razorpay_signature,
          );
    if (!signed) {
      logger.warn({ checkout: c.public_id }, 'Invalid payment signature');
      throw ApiError.badRequest(
        "We couldn't verify this payment.",
        undefined,
        'PAYMENT_SIGNATURE_INVALID',
      );
    }
    if (c.type === 'mandate') {
      const sub = await gateway.fetchSubscription(c.razorpay_subscription_id!);
      if (sub) await finalizeMandate(c, sub);
    } else {
      const p = await gateway.fetchPayment(body.razorpay_payment_id);
      if (!p) throw ApiError.badRequest('Payment not found.', undefined, 'PAYMENT_NOT_FOUND');
      await finalize(c, p, { subscriptionId: c.razorpay_subscription_id ?? undefined });
    }
  }
  const fresh = (await PaymentCheckout.findById(c._id))!;
  const me = (await User.findById(user._id))!;
  return { ...statusDto(fresh), subscription: await subscriptionDto(me) };
}

/** Looks at Razorpay directly, for when the app was killed or no webhook arrived. */
async function reconcile(c: CheckoutDoc) {
  if (!['created', 'pending', 'cancelled', 'expired'].includes(c.status)) return;
  if (c.checked_at && Date.now() - c.checked_at.getTime() < POLL_THROTTLE_MS) return;
  await PaymentCheckout.updateOne({ _id: c._id }, { $set: { checked_at: new Date() } });
  try {
    if (c.type === 'mandate') {
      const sub = await gateway.fetchSubscription(c.razorpay_subscription_id!);
      if (sub) await finalizeMandate(c, sub);
      return;
    }
    let payments: RzpPayment[] = [];
    if (c.razorpay_qr_id) payments = payments.concat(await gateway.qrPayments(c.razorpay_qr_id));
    if (c.type === 'order' && c.razorpay_order_id) {
      payments = payments.concat(await gateway.orderPayments(c.razorpay_order_id));
    }
    if (c.type === 'subscription' && c.razorpay_subscription_id) {
      payments = await gateway.subscriptionPayments(c.razorpay_subscription_id);
    }
    const captured = payments.find((p) => p.status === 'captured');
    if (captured) {
      const fromQr = c.razorpay_qr_id && !captured.order_id;
      await finalize(c, captured, {
        subscriptionId: c.razorpay_subscription_id ?? undefined,
        qrId: fromQr ? c.razorpay_qr_id! : undefined,
      });
    } else if (payments.some((p) => p.status === 'authorized')) {
      await PaymentCheckout.updateOne({ _id: c._id, status: 'created' }, { $set: { status: 'pending' } });
    }
  } catch (err) {
    logger.warn({ err, checkout: c.public_id }, 'Payment reconcile failed');
  }
}

export function statusDto(c: CheckoutDoc) {
  return {
    id: c.public_id,
    status: c.status,
    failure_reason: c.failure_reason ?? null,
    type: c.type,
    plan_id: c.plan_id,
    period: c.period,
    autopay: c.autopay,
    method: c.method,
    amount_paise: c.amount_paise,
    expires_at: c.expires_at.toISOString(),
    paid_at: c.paid_at ? c.paid_at.toISOString() : null,
    qr: c.razorpay_qr_id ? { image_url: c.qr_image_url, close_by: c.expires_at.toISOString() } : null,
  };
}

export async function checkoutStatus(user: UserDoc, checkoutId: string) {
  let c = await ownCheckout(user, checkoutId);
  if (['created', 'pending'].includes(c.status)) {
    await reconcile(c);
    c = (await PaymentCheckout.findById(c._id))!;
    if (c.status === 'created' && c.expires_at <= new Date()) {
      await PaymentCheckout.updateOne({ _id: c._id, status: 'created' }, { $set: { status: 'expired' } });
      c.status = 'expired';
    }
  }
  return statusDto(c);
}

/** A payment the app may have lost track of (killed during payment). */
export async function pendingCheckout(user: UserDoc) {
  const since = new Date(Date.now() - PENDING_GIVE_UP_MS);
  const rows = await PaymentCheckout.find({
    user_id: user._id,
    status: { $in: ['created', 'pending'] },
    created_at: { $gte: since },
  })
    .sort({ created_at: -1 })
    .limit(3);
  for (const c of rows) await reconcile(c);
  const pending = await PaymentCheckout.findOne({
    user_id: user._id,
    status: 'pending',
    created_at: { $gte: since },
  }).sort({ created_at: -1 });
  return { checkout: pending ? statusDto(pending) : null };
}

/** The app reports a closed sheet or a failure callback; never marks anything paid. */
export async function abandon(user: UserDoc, checkoutId: string, reason: 'cancelled' | 'failed', description?: string) {
  const c = await ownCheckout(user, checkoutId);
  await PaymentCheckout.updateOne(
    { _id: c._id, status: 'created' },
    {
      $set: {
        status: reason,
        failure_reason: reason === 'failed' ? (description?.slice(0, 200) ?? 'Payment failed') : 'closed',
      },
    },
  );
  return statusDto((await PaymentCheckout.findById(c._id))!);
}

export async function createQr(user: UserDoc, checkoutId: string) {
  const c = await ownCheckout(user, checkoutId);
  if (c.type !== 'order') {
    throw ApiError.badRequest('QR is for one-time payments.', undefined, 'METHOD_NOT_FOR_AUTOPAY');
  }
  if (c.status !== 'created' || c.expires_at <= new Date()) {
    throw ApiError.conflict('This checkout has expired. Start again.', 'CHECKOUT_EXPIRED');
  }
  if (!c.razorpay_qr_id) {
    const qr = await gateway.createQr({
      amount: c.amount_paise,
      closeBy: c.expires_at,
      description: `Nexity ${PLANS[c.plan_id as PlanId].name} · ${PERIOD_LABEL[c.period as Period]}`,
      notes: { checkout_id: c.public_id, user_id: user.id as string },
    });
    c.razorpay_qr_id = qr.id;
    c.qr_image_url = qr.image_url;
    await c.save();
  }
  return { ...statusDto(c), simulator: paymentsMode === 'simulator' };
}

/** Simulator only: plays Razorpay's checkout sheet so the whole flow can be tested without keys. */
export async function simulate(
  user: UserDoc,
  body: { checkout_id: string; outcome: 'success' | 'failure'; method: SimMethod; amount_paise?: number },
) {
  if (paymentsMode !== 'simulator') throw ApiError.notFound();
  const c = await ownCheckout(user, body.checkout_id);
  const result = simulatePayment({
    orderId: c.razorpay_qr_id ? null : c.razorpay_order_id,
    subscriptionId: c.razorpay_subscription_id,
    qrId: c.razorpay_qr_id,
    method: body.method,
    outcome: body.outcome,
    amountPaise: body.amount_paise,
  });
  if ('error' in result && result.error) {
    await markFailed(c, result.error);
  }
  return result;
}

/* ---------- Manage AutoPay ---------- */

export async function cancelAutopay(user: UserDoc) {
  const e = user.entitlement;
  const ent = entitlementOf(user);
  if (ent.status !== 'active' || e?.source !== 'razorpay' || !e.autopay || !e.razorpay_subscription_id) {
    throw ApiError.conflict('AutoPay is not on for your plan.', 'AUTOPAY_NOT_ACTIVE');
  }
  await gateway.cancelSubscription(e.razorpay_subscription_id, true);
  user.set('entitlement.autopay', false);
  user.set('entitlement.cancel_at_period_end', true);
  user.set('entitlement.billing_status', 'canceled');
  user.set('entitlement.next_charge_at', null);
  await user.save();
  emitSubscription(user);
  return subscriptionDto(user);
}

/** New mandate that starts when the current period ends; nothing is charged today. */
export async function resumeAutopay(user: UserDoc, idempotencyKey: string, platform?: string) {
  const e = user.entitlement;
  const ent = entitlementOf(user);
  if (ent.status !== 'active' || e?.source !== 'razorpay' || !e.period || !ent.expires_at) {
    throw ApiError.conflict('Buy a plan to turn on AutoPay.', 'AUTOPAY_NOT_AVAILABLE');
  }
  if (e.autopay) throw ApiError.conflict('AutoPay is already on.', 'ALREADY_ON_PLAN');
  const existing = await PaymentCheckout.findOne({ user_id: user._id, idempotency_key: idempotencyKey });
  if (existing) return checkoutDto(existing, user);

  const period = e.period as Period;
  const plan = PLANS[ent.plan];
  const planId = await razorpayPlanId(plan.id, period);
  const c = await PaymentCheckout.create({
    public_id: randomUUID(),
    user_id: user._id,
    plan_id: plan.id,
    period,
    type: 'mandate',
    autopay: true,
    kind: 'resume',
    quote: {
      months: PERIOD_MONTHS[period],
      mrp_paise: plan.pricing[period],
      base_paise: plan.pricing[period],
      launch_off_paise: 0,
      period_off_paise: 0,
      amount_paise: 0,
      renewal_paise: plan.pricing[period],
      starts_at: ent.expires_at,
      ends_at: ent.expires_at,
    },
    amount_paise: 0,
    idempotency_key: idempotencyKey,
    expires_at: new Date(Date.now() + CHECKOUT_TTL_MS),
    platform: platform ?? null,
    razorpay_plan_id: planId,
  });
  try {
    const sub = await gateway.createSubscription({
      planId,
      totalCount: TOTAL_COUNT[period],
      startAt: ent.expires_at,
      upfrontPaise: 0,
      upfrontName: '',
      notes: { checkout_id: c.public_id, user_id: user.id as string, plan: plan.id, period },
    });
    c.razorpay_subscription_id = sub.id;
    await c.save();
  } catch (err) {
    c.status = 'failed';
    await c.save();
    throw err;
  }
  return checkoutDto(c, user);
}

export async function history(user: UserDoc) {
  const [payments, failed] = await Promise.all([
    Payment.find({ user_id: user._id }).sort({ created_at: -1 }).limit(50).lean(),
    PaymentCheckout.find({
      user_id: user._id,
      status: { $in: ['failed', 'amount_mismatch'] },
      failure_reason: { $ne: 'provider_error' },
    })
      .sort({ created_at: -1 })
      .limit(20)
      .lean(),
  ]);
  const items = [
    ...payments.map((p) => ({
      id: p.razorpay_payment_id,
      plan_id: p.plan_id,
      period: p.period,
      kind: p.kind,
      amount_paise: p.amount_paise,
      method_display: p.method_display,
      status: p.status === 'captured' ? 'paid' : p.status,
      period_end: p.period_end ? p.period_end.toISOString() : null,
      created_at: (p.created_at as Date).toISOString(),
    })),
    ...failed.map((c) => ({
      id: c.public_id,
      plan_id: c.plan_id,
      period: c.period,
      kind: 'one_time' as const,
      amount_paise: c.amount_paise,
      method_display: c.method ? c.method.toUpperCase() : null,
      status: c.status === 'amount_mismatch' ? 'refunded' : 'failed',
      period_end: null,
      created_at: (c.created_at as Date).toISOString(),
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { items };
}

/* ---------- Webhooks (source of truth) ---------- */

async function userBySubscription(subscriptionId: string) {
  return User.findOne({ 'entitlement.razorpay_subscription_id': subscriptionId });
}

/** AutoPay renewal charged by Razorpay. */
async function renew(sub: RzpSubscription, p: RzpPayment) {
  if (p.status !== 'captured') return;
  const onSub = (await gateway.subscriptionPayments(sub.id)).some((row) => row.id === p.id);
  if (!onSub) return;
  const user = await userBySubscription(sub.id);
  if (!user) return;
  const e = user.entitlement!;
  const period = e.period as Period;
  const expected = PLANS[e.plan as PlanId].pricing[period];
  if (p.amount !== (e.price_paise ?? expected) || p.currency !== 'INR') {
    logger.error({ sub: sub.id, got: p.amount, expected }, 'Renewal amount mismatch — refunding');
    await gateway.refund(p.id).catch(() => undefined);
    return;
  }
  try {
    await Payment.create({
      razorpay_payment_id: p.id,
      user_id: user._id,
      razorpay_subscription_id: sub.id,
      plan_id: e.plan,
      period,
      kind: 'renewal',
      amount_paise: p.amount,
      method: p.method,
      method_display: methodDisplay(p),
    });
  } catch (err) {
    if (isDuplicate(err)) return;
    throw err;
  }
  const now = new Date();
  const start = e.expires_at && e.expires_at > now ? e.expires_at : now;
  const end = new Date(start.getTime() + periodMs(period));
  user.set('entitlement.expires_at', end);
  user.set('entitlement.period_started_at', start);
  user.set('entitlement.paid_paise', p.amount);
  user.set('entitlement.next_charge_at', end);
  user.set('entitlement.billing_status', 'active');
  user.set('entitlement.method_display', methodDisplay(p) ?? e.method_display);
  user.set('entitlement.reminded', null);
  user.set('entitlement.updated_at', now);
  await user.save();
  await Payment.updateOne({ razorpay_payment_id: p.id }, { $set: { period_start: start, period_end: end } });
  await syncCrushes(user);
  await notify(
    user._id,
    'payment_renewed',
    `${rupees(p.amount)} paid — ${PLANS[e.plan as PlanId].name} renewed until ${day(end)}.`,
  );
  emitSubscription(user);
}

async function endPlan(user: UserDoc, type: NotificationType, text: string) {
  const now = new Date();
  user.set('entitlement', { plan: 'free', expires_at: null, source: null, updated_at: now });
  await user.save();
  await syncCrushes(user);
  await notify(user._id, type, text);
  emitSubscription(user);
}

type WebhookPayload = {
  event: string;
  payload: {
    payment?: { entity: RzpPayment };
    subscription?: { entity: RzpSubscription };
    refund?: { entity: { id: string; payment_id: string; amount: number } };
    qr_code?: { entity: { id: string } };
    order?: { entity: { id: string } };
  };
};

/** Webhook JSON is not enough: the payment must exist at the gateway with this id. */
async function gatewayPayment(entity: RzpPayment | undefined) {
  if (!entity?.id) return null;
  return gateway.fetchPayment(entity.id);
}

async function handleEvent(evt: WebhookPayload) {
  const claimed = evt.payload.payment?.entity;
  const p = await gatewayPayment(claimed);
  const sub = evt.payload.subscription?.entity;
  switch (evt.event) {
    case 'payment.authorized':
    case 'payment.captured':
    case 'order.paid': {
      if (!p?.order_id) return 'ignored';
      const c = await PaymentCheckout.findOne({ razorpay_order_id: p.order_id });
      if (!c) return 'ignored';
      await finalize(c, p);
      return 'processed';
    }
    case 'payment.failed': {
      if (!p || p.status !== 'failed' || !p.order_id) return 'ignored';
      const c = await PaymentCheckout.findOne({ razorpay_order_id: p.order_id });
      if (!c) return 'ignored';
      await markFailed(c, p.error_description);
      return 'processed';
    }
    case 'qr_code.credited': {
      const qrId = evt.payload.qr_code?.entity.id;
      const c = qrId ? await PaymentCheckout.findOne({ razorpay_qr_id: qrId }) : null;
      if (!c || !p) return 'ignored';
      await finalize(c, p, { qrId });
      return 'processed';
    }
    case 'subscription.authenticated':
    case 'subscription.activated':
    case 'subscription.charged': {
      if (!sub) return 'ignored';
      const liveSub = await gateway.fetchSubscription(sub.id);
      if (!liveSub) return 'ignored';
      const c = await PaymentCheckout.findOne({ razorpay_subscription_id: liveSub.id });
      if (c?.type === 'mandate') {
        await finalizeMandate(c, liveSub);
        return 'processed';
      }
      if (c && c.status !== 'paid' && p) {
        await finalize(c, p, { subscriptionId: liveSub.id });
        return 'processed';
      }
      if (evt.event === 'subscription.charged' && p && !(await Payment.exists({ razorpay_payment_id: p.id }))) {
        await renew(liveSub, p);
      }
      return 'processed';
    }
    case 'subscription.pending': {
      const live = sub ? await gateway.fetchSubscription(sub.id) : null;
      if (!live || live.status !== 'pending') return 'ignored';
      const user = await userBySubscription(live.id);
      if (!user) return 'ignored';
      const graceEnd = new Date(Date.now() + GRACE_MS);
      const cur = user.entitlement?.expires_at;
      user.set('entitlement.billing_status', 'in_grace');
      if (!cur || cur < graceEnd) user.set('entitlement.expires_at', graceEnd);
      await user.save();
      await notify(
        user._id,
        'subscription_renewal_failed',
        `We couldn't renew your ${PLANS[user.entitlement!.plan as PlanId].name} plan. Pay now to keep Secret features.`,
      );
      emitSubscription(user);
      return 'processed';
    }
    case 'subscription.halted': {
      const live = sub ? await gateway.fetchSubscription(sub.id) : null;
      if (!live || live.status !== 'halted') return 'ignored';
      const user = await userBySubscription(live.id);
      if (!user) return 'ignored';
      await endPlan(
        user,
        'subscription_expired',
        'Your plan has ended because the renewal payment failed. Your Secret Crushes are paused until you subscribe again.',
      );
      return 'processed';
    }
    case 'subscription.cancelled':
    case 'subscription.completed': {
      const live = sub ? await gateway.fetchSubscription(sub.id) : null;
      if (!live || !['cancelled', 'completed'].includes(live.status)) return 'ignored';
      const user = await userBySubscription(live.id);
      if (!user) return 'ignored';
      user.set('entitlement.autopay', false);
      user.set('entitlement.cancel_at_period_end', true);
      user.set('entitlement.billing_status', 'canceled');
      user.set('entitlement.next_charge_at', null);
      await user.save();
      emitSubscription(user);
      return 'processed';
    }
    case 'refund.processed': {
      const refund = evt.payload.refund?.entity;
      if (!refund) return 'ignored';
      const row = await Payment.findOne({ razorpay_payment_id: refund.payment_id });
      if (!row) return 'ignored';
      row.refunded_paise = Math.min(row.amount_paise, (row.refunded_paise ?? 0) + refund.amount);
      row.status = row.refunded_paise >= row.amount_paise ? 'refunded' : 'partially_refunded';
      await row.save();
      const user = await User.findById(row.user_id);
      if (!user) return 'processed';
      if (row.status === 'refunded' && row.period_end && row.period_end.getTime() === user.entitlement?.expires_at?.getTime()) {
        await endPlan(
          user,
          'payment_refunded',
          `${rupees(refund.amount)} has been refunded to your original payment method.`,
        );
      } else {
        await notify(user._id, 'payment_refunded', `${rupees(refund.amount)} has been refunded to your original payment method.`);
      }
      return 'processed';
    }
    case 'payment.dispute.created':
      logger.error({ payment: p?.id }, 'Payment dispute opened');
      return 'processed';
    default:
      return 'ignored';
  }
}

export async function handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined) {
  const secret = webhookSecret();
  if (!secret || !safeEqualHex(hmacHex(rawBody, secret), signature)) {
    logger.error('Razorpay webhook signature invalid');
    throw ApiError.badRequest('Invalid signature', undefined, 'WEBHOOK_SIGNATURE_INVALID');
  }
  const evt = JSON.parse(rawBody.toString('utf8')) as WebhookPayload;
  const id = eventId ?? hmacHex(rawBody, secret);
  try {
    await PaymentWebhookEvent.create({ event_id: id, event: evt.event, status: 'processed', received_at: new Date() });
  } catch (err) {
    if (isDuplicate(err)) return { status: 'duplicate' };
    throw err;
  }
  try {
    const status = await handleEvent(evt);
    await PaymentWebhookEvent.updateOne({ event_id: id }, { $set: { status } });
    return { status };
  } catch (err) {
    // Remove the marker so Razorpay's retry is processed again.
    await PaymentWebhookEvent.deleteOne({ event_id: id });
    throw err;
  }
}

/* ---------- Background job ---------- */

async function remind(user: UserDoc, key: string, type: NotificationType, text: string) {
  const res = await User.updateOne(
    { _id: user._id, 'entitlement.reminded': { $ne: key } },
    { $set: { 'entitlement.reminded': key } },
  );
  if (res.modifiedCount) await notify(user._id, type, text);
}

export async function runPaymentsJob(now = new Date()) {
  // Unpaid checkouts: one last look at Razorpay (missed webhooks), then expire.
  const stale = await PaymentCheckout.find({ status: 'created', expires_at: { $lte: now } }).limit(100);
  for (const c of stale) {
    await reconcile(c);
    await PaymentCheckout.updateOne({ _id: c._id, status: 'created' }, { $set: { status: 'expired' } });
  }
  const stuck = await PaymentCheckout.find({
    status: 'pending',
    updated_at: { $lte: new Date(now.getTime() - PENDING_GIVE_UP_MS) },
  }).limit(100);
  for (const c of stuck) {
    await reconcile(c);
    const res = await PaymentCheckout.updateOne(
      { _id: c._id, status: 'pending' },
      { $set: { status: 'failed', failure_reason: 'Not confirmed by the bank in time' } },
    );
    if (res.modifiedCount) {
      await notify(
        c.user_id,
        'payment_failed',
        `Your payment of ${rupees(c.amount_paise)} didn't go through. No money was deducted.`,
      );
    }
  }

  // Reminders.
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const ending = await User.find({
    'entitlement.source': 'razorpay',
    'entitlement.autopay': { $ne: true },
    'entitlement.expires_at': { $gt: now, $lte: soon },
  }).limit(500);
  for (const u of ending) {
    const end = u.entitlement!.expires_at!;
    const days = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
    const name = PLANS[u.entitlement!.plan as PlanId].name;
    const key = `${days <= 1 ? '1d' : '3d'}:${end.toISOString()}`;
    await remind(
      u,
      key,
      'subscription_expiring',
      days <= 1
        ? `Your ${name} plan ends tomorrow. Renew now 💌`
        : `Your ${name} plan ends in ${days} days. Renew now 💌`,
    );
  }
  const renewing = await User.find({
    'entitlement.source': 'razorpay',
    'entitlement.autopay': true,
    'entitlement.next_charge_at': { $gt: now, $lte: new Date(now.getTime() + 86_400_000) },
  }).limit(500);
  for (const u of renewing) {
    const e = u.entitlement!;
    await remind(
      u,
      `renew:${e.next_charge_at!.toISOString()}`,
      'payment_renewal_upcoming',
      `Your ${PLANS[e.plan as PlanId].name} renews tomorrow for ${rupees(e.price_paise ?? 0)} via ${e.method_display ?? 'AutoPay'}.`,
    );
  }

  // Lapsed plans: back to Free, crushes paused.
  const lapsed = await User.find({
    'entitlement.plan': { $ne: 'free' },
    'entitlement.expires_at': { $lte: now },
  }).limit(200);
  for (const u of lapsed) {
    const name = PLANS[u.entitlement!.plan as PlanId].name;
    await endPlan(
      u,
      'subscription_expired',
      `Your ${name} plan has ended. Subscribe again to unlock Secret Messages and Secret Crush.`,
    );
  }
}
