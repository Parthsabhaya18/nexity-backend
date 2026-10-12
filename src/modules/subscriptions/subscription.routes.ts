import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import { devPlanSwitch, paymentsMode } from '../../config/env';
import { profileUpdateLimiter, subscriptionManageLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { emitToUser } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import {
  assertPaymentsAvailable,
  cancelAutopay,
  catalog,
  paymentsInfo,
  resumeAutopay,
} from '../payments/payments.service';
import { syncCrushes } from '../secret-crush/crush.service';
import { PLAN_IDS } from '../users/user.model';
import { subscriptionDto } from './entitlement.service';
import { plansPageDto, refreshPlans } from './plans';

const TEST_PLAN_DAYS = 30;

const listPlans: RequestHandler = async (req, res) => {
  await refreshPlans();
  const platform = (req.get('x-platform') ?? 'android').toLowerCase();
  let checkoutAvailable = paymentsMode !== 'off';
  try {
    assertPaymentsAvailable(platform);
  } catch {
    checkoutAvailable = false;
  }
  const data = catalog();
  res.json({
    data,
    page: plansPageDto(data.map((p) => p.id)),
    checkout_available: checkoutAvailable,
    payments: paymentsInfo(),
    dev_switch: devPlanSwitch,
  });
};

const me: RequestHandler = async (req, res) => {
  res.json(await subscriptionDto(req.user!));
};

const activateSchema = z.object({ plan: z.enum(PLAN_IDS) }).strict();

const devActivate: RequestHandler = async (req, res) => {
  if (!devPlanSwitch) throw ApiError.notFound();
  const { plan } = activateSchema.parse(req.body);
  const user = req.user!;
  const now = new Date();
  user.set('entitlement', {
    plan,
    expires_at: plan === 'free' ? null : new Date(now.getTime() + TEST_PLAN_DAYS * 86_400_000),
    source: plan === 'free' ? null : 'dev',
    updated_at: now,
  });
  await user.save();
  // Pauses crushes beyond the new plan's spots, or reactivates them and runs the match check.
  await syncCrushes(user);
  const dto = await subscriptionDto(user);
  emitToUser(user.id as string, 'subscription.updated', dto);
  res.json(dto);
};

const cancel: RequestHandler = async (req, res) => {
  res.json(await cancelAutopay(req.user!));
};

const resume: RequestHandler = async (req, res) => {
  const platform = req.get('x-platform') ?? undefined;
  assertPaymentsAvailable(platform);
  const key = req.get('idempotency-key');
  if (!key || !z.uuid().safeParse(key).success) {
    throw ApiError.badRequest('Idempotency-Key header (UUID) is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  res.status(201).json(await resumeAutopay(req.user!, key, platform));
};

export const plansRouter = Router();
plansRouter.use(requireAuth);
plansRouter.get('/', listPlans);

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);
subscriptionsRouter.get('/me', me);
subscriptionsRouter.post('/me/cancel', subscriptionManageLimiter, cancel);
subscriptionsRouter.post('/me/resume', subscriptionManageLimiter, resume);
subscriptionsRouter.post('/dev/activate', profileUpdateLimiter, devActivate);
