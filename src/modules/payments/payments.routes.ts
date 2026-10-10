import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import {
  paymentCheckoutLimiter,
  paymentQrLimiter,
  paymentQuoteLimiter,
  paymentStatusLimiter,
  paymentVerifyLimiter,
} from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { ApiError } from '../../utils/ApiError';
import { PLAN_IDS } from '../users/user.model';
import { PERIODS } from '../subscriptions/plans';
import {
  abandon,
  assertPaymentsAvailable,
  checkoutStatus,
  createCheckout,
  createQr,
  handleWebhook,
  history,
  PAYMENT_METHODS,
  pendingCheckout,
  quote,
  simulate,
  verify,
} from './payments.service';
import { quoteDto } from './quote';

const planInput = z
  .object({
    plan_id: z.enum(PLAN_IDS),
    period: z.enum(PERIODS),
    autopay: z.boolean(),
    coupon_code: z.string().trim().max(32).nullish(),
    method: z.enum(PAYMENT_METHODS).nullish(),
  })
  .strict();

const verifySchema = z
  .object({
    checkout_id: z.uuid(),
    razorpay_payment_id: z.string().min(4).max(64),
    razorpay_signature: z.string().min(16).max(256),
    razorpay_order_id: z.string().max(64).optional(),
    razorpay_subscription_id: z.string().max(64).optional(),
  })
  .strict();

const idParam = z.object({ id: z.uuid() });

const platformOf = (req: Parameters<RequestHandler>[0]) => req.get('x-platform') ?? undefined;

const available: RequestHandler = (req, _res, next) => {
  assertPaymentsAvailable(platformOf(req));
  next();
};

function idempotencyKey(req: Parameters<RequestHandler>[0]) {
  const key = req.get('idempotency-key');
  if (!key || !z.uuid().safeParse(key).success) {
    throw ApiError.badRequest('Idempotency-Key header (UUID) is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return key;
}

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post('/quote', paymentQuoteLimiter, available, async (req, res) => {
  res.json(quoteDto(await quote(req.user!, planInput.parse(req.body))));
});

paymentsRouter.post('/checkout', paymentCheckoutLimiter, available, async (req, res) => {
  const body = planInput.parse(req.body);
  res.status(201).json(await createCheckout(req.user!, body, idempotencyKey(req), platformOf(req)));
});

paymentsRouter.post('/verify', paymentVerifyLimiter, async (req, res) => {
  const result = await verify(req.user!, verifySchema.parse(req.body));
  res.status(result.status === 'pending' ? 202 : 200).json(result);
});

paymentsRouter.get('/checkouts/pending', paymentStatusLimiter, async (req, res) => {
  res.json(await pendingCheckout(req.user!));
});

paymentsRouter.get('/checkouts/:id', paymentStatusLimiter, async (req, res) => {
  res.json(await checkoutStatus(req.user!, idParam.parse(req.params).id));
});

paymentsRouter.post('/checkouts/:id/abandon', paymentStatusLimiter, async (req, res) => {
  const body = z
    .object({ reason: z.enum(['cancelled', 'failed']), description: z.string().max(300).optional() })
    .strict()
    .parse(req.body);
  res.json(await abandon(req.user!, idParam.parse(req.params).id, body.reason, body.description));
});

paymentsRouter.post('/qr', paymentQrLimiter, available, async (req, res) => {
  const { checkout_id } = z.object({ checkout_id: z.uuid() }).strict().parse(req.body);
  res.json(await createQr(req.user!, checkout_id));
});

paymentsRouter.get('/history', async (req, res) => {
  res.json(await history(req.user!));
});

/** Simulator only (404 with real keys): stands in for Razorpay's checkout sheet. */
paymentsRouter.post('/dev/simulate', paymentVerifyLimiter, async (req, res) => {
  const body = z
    .object({
      checkout_id: z.uuid(),
      outcome: z.enum(['success', 'failure']),
      method: z.enum(['upi', 'card', 'netbanking', 'wallet']).default('upi'),
      amount_paise: z.number().int().positive().optional(),
    })
    .strict()
    .parse(req.body);
  res.json(await simulate(req.user!, body));
});

/** Mounted before `express.json()` with a raw body (signature is over the exact bytes). */
export const razorpayWebhook: RequestHandler = async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw ApiError.badRequest('Expected a raw JSON body');
  const result = await handleWebhook(
    req.body,
    req.get('x-razorpay-signature') ?? undefined,
    req.get('x-razorpay-event-id') ?? undefined,
  );
  res.json({ ok: true, ...result });
};
