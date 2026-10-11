import { randomUUID } from 'node:crypto';

import { emitToUser } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { MONGO_DUPLICATE_KEY } from '../../utils/mongo';
import { syncCrushes } from '../secret-crush/crush.service';
import { subscriptionDto } from '../subscriptions/entitlement.service';
import { type PlanId, User, type UserDoc } from '../users/user.model';
import { BillingAdjustment, Payment, Refund } from './payment.models';
import { gateway } from './razorpay.gateway';
import { computeQuote, quoteDto, type Quote } from './quote';

function isDuplicate(err: unknown) {
  return err instanceof Error && 'code' in err && (err as { code?: number }).code === MONGO_DUPLICATE_KEY;
}

function creditKey(user: UserDoc) {
  const e = user.entitlement;
  if (!e?.period_started_at || e.paid_paise == null) return null;
  return `${user.id}:${e.period_started_at.toISOString()}:${e.paid_paise}`;
}

async function holdCredit(user: UserDoc, token: string) {
  const held = await User.findOneAndUpdate(
    { _id: user._id, 'entitlement.credit_hold': null },
    { $set: { 'entitlement.credit_hold': token } },
  );
  if (!held) {
    throw ApiError.conflict(
      'Another plan change is already using this subscription credit.',
      'CREDIT_IN_USE',
    );
  }
}

async function releaseHold(userId: UserDoc['_id'], token: string) {
  await User.updateOne(
    { _id: userId, 'entitlement.credit_hold': token },
    { $set: { 'entitlement.credit_hold': null } },
  );
}

export async function previewPlanChange(
  user: UserDoc,
  input: { plan_id: PlanId; period: Quote['period'] },
) {
  const quote = await computeQuote(user, { ...input, autopay: false });
  if (quote.kind !== 'upgrade' && quote.kind !== 'downgrade') {
    throw ApiError.badRequest('Choose a different plan to see the price difference.', undefined, 'PLAN_UNCHANGED');
  }
  return quoteDto(quote);
}

/**
 * Applies a downgrade, or an upgrade that the unused credit covers completely.
 * A payable upgrade must go through Razorpay checkout instead.
 * The quote is computed again here. If it no longer matches what the user confirmed, nothing changes.
 */
export async function confirmPlanChange(
  user: UserDoc,
  input: {
    plan_id: PlanId;
    period: Quote['period'];
    expected_amount_paise: number;
    expected_extra_days: number;
  },
) {
  const quote = await computeQuote(user, { plan_id: input.plan_id, period: input.period, autopay: false });
  if (quote.kind !== 'upgrade' && quote.kind !== 'downgrade') {
    throw ApiError.badRequest('That plan change is not available.', undefined, 'PLAN_UNCHANGED');
  }
  if (quote.amount_paise !== input.expected_amount_paise || quote.extra_days !== input.expected_extra_days) {
    throw ApiError.conflict(
      'The price changed. Review the updated calculation before confirming.',
      'PREVIEW_STALE',
      { quote: quoteDto(quote) },
    );
  }
  if (quote.amount_paise > 0) {
    throw ApiError.conflict(
      'This upgrade needs a payment for the difference. Continue to checkout.',
      'PAYMENT_REQUIRED',
      { quote: quoteDto(quote) },
    );
  }

  const key = creditKey(user);
  const started = user.entitlement?.period_started_at;
  if (!key || !started) {
    throw ApiError.conflict('This plan has no paid time to convert.', 'NO_UNUSED_CREDIT');
  }
  const token = `change:${randomUUID()}`;
  await holdCredit(user, token);
  try {
    await BillingAdjustment.create({
      credit_key: key,
      user_id: user._id,
      reason: quote.kind === 'downgrade' ? 'downgrade' : 'upgrade',
      from_plan: user.entitlement?.plan ?? 'free',
      to_plan: quote.plan_id,
      from_period: user.entitlement?.period ?? null,
      to_period: quote.period,
      period_started_at: started,
      period_days: quote.period_days,
      consumed_days: quote.consumed_days,
      price_paise: user.entitlement?.paid_paise ?? 0,
      consumed_paise: quote.consumed_paise,
      unused_paise: quote.unused_paise,
      credit_applied_paise: quote.credit_paise,
      payable_paise: 0,
      extra_days: quote.extra_days,
      granted_paise: quote.unused_paise + quote.rounding_adjustment_paise,
      rounding_adjustment_paise: quote.rounding_adjustment_paise,
    });
  } catch (err) {
    await releaseHold(user._id, token);
    if (isDuplicate(err)) {
      throw ApiError.conflict('This subscription credit was already used.', 'CREDIT_ALREADY_USED');
    }
    throw err;
  }

  const oldSubscription = user.entitlement?.razorpay_subscription_id ?? null;
  const fresh = await User.findById(user._id);
  if (!fresh) throw ApiError.notFound('Account not found.');
  const now = new Date();
  const granted = quote.unused_paise + quote.rounding_adjustment_paise;
  fresh.set('entitlement', {
    plan: quote.plan_id,
    expires_at: quote.ends_at,
    source: 'razorpay',
    updated_at: now,
    period: quote.period,
    autopay: false,
    razorpay_subscription_id: null,
    price_paise: quote.base_paise,
    paid_paise: Math.max(0, granted),
    period_started_at: now,
    next_charge_at: null,
    cancel_at_period_end: false,
    billing_status: 'active',
    method_display: fresh.entitlement?.method_display ?? user.entitlement?.method_display ?? null,
    reminded: null,
    credit_hold: null,
    billing_generation: (user.entitlement?.billing_generation ?? 0) + 1,
  });
  await fresh.save();
  await syncCrushes(fresh);
  if (oldSubscription) {
    await gateway
      .cancelSubscription(oldSubscription, false)
      .catch((err: unknown) => logger.warn({ err }, 'Old AutoPay cancel after plan change failed'));
  }
  const dto = await subscriptionDto(fresh);
  emitToUser(fresh.id as string, 'subscription.updated', dto);
  return { subscription: dto, quote: quoteDto(quote) };
}

export async function requestRefund(
  user: UserDoc,
  input: { payment_id: string; amount_paise?: number; reason: string },
  idempotencyKey: string,
) {
  const existing = await Refund.findOne({ user_id: user._id, idempotency_key: idempotencyKey });
  if (existing) {
    return refundDto(existing);
  }
  const payment = await Payment.findOne({ razorpay_payment_id: input.payment_id, user_id: user._id });
  if (!payment) throw ApiError.notFound('That payment was not found.');
  if (payment.status === 'refunded') {
    throw ApiError.conflict('This payment is already refunded.', 'REFUND_NOT_AVAILABLE');
  }
  const already = payment.refunded_paise ?? 0;
  const remaining = payment.amount_paise - already;
  if (remaining <= 0) {
    throw ApiError.conflict('This payment is already refunded.', 'REFUND_NOT_AVAILABLE');
  }
  const amount = input.amount_paise ?? remaining;
  if (!Number.isInteger(amount) || amount < 100 || amount > remaining) {
    throw ApiError.badRequest('That refund amount is not available for this payment.', undefined, 'REFUND_AMOUNT_INVALID');
  }
  if (payment.period_start) {
    const spent = await BillingAdjustment.exists({
      user_id: user._id,
      period_started_at: payment.period_start,
    });
    if (spent) {
      throw ApiError.conflict(
        'This payment was already converted into plan time. A downgrade is not a cash refund.',
        'CREDIT_ALREADY_USED',
      );
    }
  }
  const open = await Refund.findOne({
    razorpay_payment_id: payment.razorpay_payment_id,
    status: 'pending',
  });
  if (open) {
    throw ApiError.conflict('A refund for this payment is already in progress.', 'REFUND_IN_PROGRESS');
  }

  let provider: { id?: string } = {};
  try {
    provider = (await gateway.refund(payment.razorpay_payment_id, amount)) ?? {};
  } catch (err) {
    logger.error({ err, payment: payment.razorpay_payment_id }, 'Razorpay refund request failed');
    throw new ApiError(502, "The refund could not be started. You have not been marked as refunded.", undefined, 'PAYMENT_PROVIDER_ERROR');
  }

  try {
    const row = await Refund.create({
      public_id: randomUUID(),
      user_id: user._id,
      payment_id: payment._id,
      razorpay_payment_id: payment.razorpay_payment_id,
      razorpay_refund_id: provider.id ?? null,
      amount_paise: amount,
      reason: input.reason,
      status: 'pending',
      idempotency_key: idempotencyKey,
    });
    return refundDto(row);
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const row = await Refund.findOne({ user_id: user._id, idempotency_key: idempotencyKey });
    return refundDto(row!);
  }
}

function refundDto(row: {
  public_id: string;
  razorpay_payment_id: string;
  razorpay_refund_id?: string | null;
  amount_paise: number;
  reason: string;
  status: string;
  created_at?: Date;
}) {
  return {
    id: row.public_id,
    payment_id: row.razorpay_payment_id,
    refund_id: row.razorpay_refund_id ?? null,
    amount_paise: row.amount_paise,
    reason: row.reason,
    status: row.status,
    created_at: row.created_at ? row.created_at.toISOString() : null,
  };
}

export async function markRefundProcessed(razorpayPaymentId: string, refundId: string, amountPaise: number, ok: boolean) {
  await Refund.updateMany(
    { razorpay_payment_id: razorpayPaymentId, status: 'pending' },
    { $set: { status: ok ? 'processed' : 'failed', razorpay_refund_id: refundId, amount_paise: amountPaise } },
  );
}
