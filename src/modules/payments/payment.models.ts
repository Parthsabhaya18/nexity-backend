import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

import { PLAN_IDS } from '../users/user.model';
import { PERIODS } from '../subscriptions/plans';

export const CHECKOUT_STATUSES = [
  'created',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'amount_mismatch',
] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/** `order` = one-time, `subscription` = AutoPay (first period charged as an upfront add-on), `mandate` = AutoPay with nothing charged today. */
export const CHECKOUT_TYPES = ['order', 'subscription', 'mandate'] as const;
export type CheckoutType = (typeof CHECKOUT_TYPES)[number];

const quoteSchema = new mongoose.Schema(
  {
    months: Number,
    mrp_paise: Number,
    base_paise: Number,
    launch_off_paise: Number,
    period_off_paise: Number,
    coupon_code: { type: String, default: null },
    coupon_pct: { type: Number, default: null },
    coupon_off_paise: { type: Number, default: 0 },
    credit_paise: { type: Number, default: 0 },
    amount_paise: Number,
    renewal_paise: { type: Number, default: null },
    starts_at: Date,
    ends_at: Date,
  },
  { _id: false },
);

/** The amount is frozen here before Razorpay is called; every payment is compared with it. */
const checkoutSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    plan_id: { type: String, enum: PLAN_IDS, required: true },
    period: { type: String, enum: PERIODS, required: true },
    type: { type: String, enum: CHECKOUT_TYPES, required: true },
    autopay: { type: Boolean, required: true },
    method: { type: String, default: null },
    /** `upgrade` when it replaces a lower active plan (pro-rated credit). */
    kind: { type: String, enum: ['new', 'renew', 'upgrade', 'resume'], required: true },
    quote: { type: quoteSchema, required: true },
    amount_paise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    razorpay_order_id: { type: String, default: null },
    razorpay_subscription_id: { type: String, default: null },
    razorpay_plan_id: { type: String, default: null },
    razorpay_qr_id: { type: String, default: null },
    qr_image_url: { type: String, default: null },
    idempotency_key: { type: String, required: true },
    status: { type: String, enum: CHECKOUT_STATUSES, default: 'created' },
    failure_reason: { type: String, default: null },
    expires_at: { type: Date, required: true },
    paid_at: { type: Date, default: null },
    platform: { type: String, default: null },
    /** Throttles provider look-ups while the app polls. */
    checked_at: { type: Date, default: null },
  },
  {
    collection: 'payment_checkouts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

checkoutSchema.index({ public_id: 1 }, { unique: true });
checkoutSchema.index({ user_id: 1, idempotency_key: 1 }, { unique: true });
checkoutSchema.index({ user_id: 1, status: 1, expires_at: 1 });
checkoutSchema.index({ razorpay_order_id: 1 }, { sparse: true });
checkoutSchema.index({ razorpay_subscription_id: 1 }, { sparse: true });
checkoutSchema.index({ razorpay_qr_id: 1 }, { sparse: true });
checkoutSchema.index({ status: 1, expires_at: 1 });

export type CheckoutDoc = HydratedDocument<InferSchemaType<typeof checkoutSchema>>;
export const PaymentCheckout = mongoose.model('PaymentCheckout', checkoutSchema);

/** One row per captured Razorpay payment. The unique payment id stops replays. */
const paymentSchema = new mongoose.Schema(
  {
    razorpay_payment_id: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    checkout_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentCheckout', default: null },
    razorpay_subscription_id: { type: String, default: null },
    plan_id: { type: String, enum: PLAN_IDS, required: true },
    period: { type: String, enum: PERIODS, required: true },
    kind: { type: String, enum: ['first', 'renewal', 'one_time', 'upgrade'], required: true },
    amount_paise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    method: { type: String, default: null },
    method_display: { type: String, default: null },
    status: {
      type: String,
      enum: ['captured', 'refunded', 'partially_refunded', 'disputed'],
      default: 'captured',
    },
    refunded_paise: { type: Number, default: 0 },
    /** Plan time this payment bought. */
    period_start: { type: Date, default: null },
    period_end: { type: Date, default: null },
  },
  {
    collection: 'payments',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

paymentSchema.index({ razorpay_payment_id: 1 }, { unique: true });
paymentSchema.index({ user_id: 1, created_at: -1 });

export type PaymentDoc = HydratedDocument<InferSchemaType<typeof paymentSchema>>;
export const Payment = mongoose.model('Payment', paymentSchema);

const webhookEventSchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true },
    event: { type: String, required: true },
    status: { type: String, enum: ['processed', 'ignored', 'failed'], required: true },
    attempts: { type: Number, default: 1 },
    error: { type: String, default: null },
    received_at: { type: Date, required: true },
  },
  { collection: 'payment_webhook_events' },
);

webhookEventSchema.index({ event_id: 1 }, { unique: true });

export const PaymentWebhookEvent = mongoose.model('PaymentWebhookEvent', webhookEventSchema);

/** One redemption per (coupon, user); `used` once the payment is captured. */
const couponRedemptionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    checkout_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentCheckout', required: true },
    used_at: { type: Date, required: true },
  },
  { collection: 'coupon_redemptions' },
);

couponRedemptionSchema.index({ code: 1, user_id: 1 }, { unique: true });
couponRedemptionSchema.index({ code: 1 });

export const CouponRedemption = mongoose.model('CouponRedemption', couponRedemptionSchema);

/** Razorpay plan entity per plan × period (AutoPay). Created on first use; immutable. */
const razorpayPlanSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    razorpay_plan_id: { type: String, required: true },
    amount_paise: { type: Number, required: true },
    mode: { type: String, required: true },
  },
  { collection: 'razorpay_plans' },
);

razorpayPlanSchema.index({ key: 1, mode: 1, amount_paise: 1 }, { unique: true });

export const RazorpayPlan = mongoose.model('RazorpayPlan', razorpayPlanSchema);
