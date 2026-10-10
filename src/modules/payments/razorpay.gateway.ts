import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env, paymentsMode } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';

/** The subset of Razorpay's payment entity Nexity reads. */
export type RzpPayment = {
  id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id: string | null;
  method: string | null;
  vpa?: string | null;
  bank?: string | null;
  wallet?: string | null;
  card?: { network?: string | null; last4?: string | null } | null;
  notes?: Record<string, string> | null;
  error_description?: string | null;
  amount_refunded?: number;
};

export type RzpSubscription = {
  id: string;
  plan_id: string;
  status: string;
  current_end?: number | null;
  charge_at?: number | null;
  notes?: Record<string, string> | null;
};

const BASE_URL = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;
const SIMULATOR_KEY_ID = 'rzp_test_simulator';
const SIMULATOR_SECRET = 'nexity-razorpay-simulator-secret';

/** Simulator mode never reads live Razorpay secrets, even when a developer `.env` has them. */
export const keyId = () =>
  paymentsMode === 'simulator' ? SIMULATOR_KEY_ID : (env.RAZORPAY_KEY_ID ?? SIMULATOR_KEY_ID);
const keySecret = () =>
  paymentsMode === 'simulator' ? SIMULATOR_SECRET : (env.RAZORPAY_KEY_SECRET ?? SIMULATOR_SECRET);
export const webhookSecret = () =>
  paymentsMode === 'simulator' ? SIMULATOR_SECRET : env.RAZORPAY_WEBHOOK_SECRET;

export const isTestKey = () => keyId().startsWith('rzp_test_');

/* ---------- Signatures (constant-time compare) ---------- */

export function hmacHex(payload: string | Buffer, secret = keySecret()) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(expected: string, received: string | undefined | null) {
  if (!received || !/^[a-f0-9]+$/i.test(received)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function orderSignature(orderId: string, paymentId: string) {
  return hmacHex(`${orderId}|${paymentId}`);
}

export function subscriptionSignature(paymentId: string, subscriptionId: string) {
  return hmacHex(`${paymentId}|${subscriptionId}`);
}

/* ---------- Real Razorpay REST client ---------- */

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
  const attempts = method === 'GET' ? 2 : 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const error = json.error as { code?: string; description?: string } | undefined;
        logger.warn({ path, status: res.status, code: error?.code }, 'Razorpay API error');
        throw new ApiError(
          502,
          error?.description ?? 'The payment provider is unavailable. Try again.',
          undefined,
          'PAYMENT_PROVIDER_ERROR',
        );
      }
      return json as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof ApiError) throw err;
    }
  }
  logger.warn({ err: lastErr, path }, 'Razorpay request failed');
  throw new ApiError(
    502,
    "Couldn't reach the payment provider. Try again.",
    undefined,
    'PAYMENT_PROVIDER_ERROR',
  );
}

/* ---------- Simulator (development / tests without keys; no money moves) ---------- */

type SimOrder = { id: string; amount: number; notes: Record<string, string>; payments: string[] };
type SimSubscription = RzpSubscription & { upfront: number; payments: string[] };
type SimQr = { id: string; amount: number; notes: Record<string, string>; payments: string[] };

const sim = {
  orders: new Map<string, SimOrder>(),
  subscriptions: new Map<string, SimSubscription>(),
  payments: new Map<string, RzpPayment>(),
  qrs: new Map<string, SimQr>(),
  plans: new Map<string, { id: string; amount: number }>(),
};

const simId = (prefix: string) => `${prefix}_sim${randomBytes(7).toString('hex')}`;

export type SimMethod = 'upi' | 'card' | 'netbanking' | 'wallet';

const SIM_DETAILS: Record<SimMethod, Partial<RzpPayment>> = {
  upi: { method: 'upi', vpa: 'success@razorpay' },
  card: { method: 'card', card: { network: 'Visa', last4: '1111' } },
  netbanking: { method: 'netbanking', bank: 'HDFC' },
  wallet: { method: 'wallet', wallet: 'paytm' },
};

function simPayment(amount: number, method: SimMethod, extra: Partial<RzpPayment>): RzpPayment {
  const p: RzpPayment = {
    id: simId('pay'),
    amount,
    currency: 'INR',
    status: 'captured',
    order_id: null,
    method,
    ...SIM_DETAILS[method],
    ...extra,
  };
  sim.payments.set(p.id, p);
  return p;
}

/**
 * What Razorpay's checkout would hand back to the app. `amountPaise` lets tests play a
 * tampered client that pays a different amount.
 */
export function simulatePayment(opts: {
  orderId?: string | null;
  subscriptionId?: string | null;
  qrId?: string | null;
  method: SimMethod;
  outcome: 'success' | 'failure';
  amountPaise?: number;
}) {
  if (paymentsMode !== 'simulator') throw ApiError.notFound();
  if (opts.qrId) {
    const qr = sim.qrs.get(opts.qrId);
    if (!qr) throw ApiError.notFound('That QR code has expired.');
    if (opts.outcome === 'failure') return { error: 'Payment declined (test).' };
    const p = simPayment(opts.amountPaise ?? qr.amount, 'upi', { notes: qr.notes });
    qr.payments.push(p.id);
    return { qr_payment_id: p.id };
  }
  if (opts.subscriptionId) {
    const s = sim.subscriptions.get(opts.subscriptionId);
    if (!s) throw ApiError.notFound();
    const p = simPayment(opts.amountPaise ?? s.upfront, opts.method, {
      status: opts.outcome === 'success' ? 'captured' : 'failed',
      error_description: opts.outcome === 'failure' ? 'Your bank declined the payment (test).' : null,
    });
    if (opts.outcome === 'failure') return { error: p.error_description };
    s.payments.push(p.id);
    s.status = 'authenticated';
    return {
      razorpay_payment_id: p.id,
      razorpay_subscription_id: s.id,
      razorpay_signature: subscriptionSignature(p.id, s.id),
    };
  }
  const order = opts.orderId ? sim.orders.get(opts.orderId) : undefined;
  if (!order) throw ApiError.notFound();
  const p = simPayment(opts.amountPaise ?? order.amount, opts.method, {
    order_id: order.id,
    status: opts.outcome === 'success' ? 'captured' : 'failed',
    error_description: opts.outcome === 'failure' ? 'Your bank declined the payment (test).' : null,
  });
  if (opts.outcome === 'failure') return { error: p.error_description };
  order.payments.push(p.id);
  return {
    razorpay_payment_id: p.id,
    razorpay_order_id: order.id,
    razorpay_signature: orderSignature(order.id, p.id),
  };
}

/** Test helper: Razorpay moving a subscription to pending / halted / cancelled. */
export function simulateSubscriptionStatus(subscriptionId: string, status: string) {
  const s = sim.subscriptions.get(subscriptionId);
  if (!s) throw new Error('unknown simulated subscription');
  s.status = status;
}

/** Test helper: a renewal charge Razorpay would make on its own. */
export function simulateRenewalPayment(subscriptionId: string, amountPaise: number) {
  const s = sim.subscriptions.get(subscriptionId);
  if (!s) throw new Error('unknown simulated subscription');
  const p = simPayment(amountPaise, 'upi', {});
  s.payments.push(p.id);
  s.status = 'active';
  return p;
}

/* ---------- Gateway API used by the payments service ---------- */

export const gateway = {
  async createOrder(o: { amount: number; receipt: string; notes: Record<string, string> }) {
    if (paymentsMode === 'simulator') {
      const order: SimOrder = { id: simId('order'), amount: o.amount, notes: o.notes, payments: [] };
      sim.orders.set(order.id, order);
      return { id: order.id };
    }
    return call<{ id: string }>('POST', '/orders', {
      amount: o.amount,
      currency: 'INR',
      receipt: o.receipt,
      notes: o.notes,
    });
  },

  async orderPayments(orderId: string): Promise<RzpPayment[]> {
    if (paymentsMode === 'simulator') {
      return (sim.orders.get(orderId)?.payments ?? []).map((id) => sim.payments.get(id)!);
    }
    const res = await call<{ items: RzpPayment[] }>('GET', `/orders/${orderId}/payments`);
    return res.items ?? [];
  },

  async fetchPayment(paymentId: string): Promise<RzpPayment | null> {
    if (paymentsMode === 'simulator') return sim.payments.get(paymentId) ?? null;
    return call<RzpPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
  },

  /** Razorpay plan entity for a plan × period price (created once). */
  async createPlan(o: { period: 'monthly' | 'yearly'; interval: number; name: string; amount: number }) {
    if (paymentsMode === 'simulator') {
      const plan = { id: simId('plan'), amount: o.amount };
      sim.plans.set(plan.id, plan);
      return { id: plan.id, item: { amount: o.amount } };
    }
    return call<{ id: string; item: { amount: number } }>('POST', '/plans', {
      period: o.period,
      interval: o.interval,
      item: { name: o.name, amount: o.amount, currency: 'INR' },
    });
  },

  async fetchPlanAmount(planId: string) {
    if (paymentsMode === 'simulator') return sim.plans.get(planId)?.amount ?? null;
    const plan = await call<{ item: { amount: number } }>('GET', `/plans/${planId}`);
    return plan.item.amount;
  },

  async createSubscription(o: {
    planId: string;
    totalCount: number;
    startAt: Date;
    upfrontPaise: number;
    upfrontName: string;
    notes: Record<string, string>;
  }) {
    if (paymentsMode === 'simulator') {
      const s: SimSubscription = {
        id: simId('sub'),
        plan_id: o.planId,
        status: 'created',
        charge_at: Math.floor(o.startAt.getTime() / 1000),
        current_end: null,
        notes: o.notes,
        upfront: o.upfrontPaise,
        payments: [],
      };
      sim.subscriptions.set(s.id, s);
      return { id: s.id };
    }
    return call<{ id: string }>('POST', '/subscriptions', {
      plan_id: o.planId,
      total_count: o.totalCount,
      quantity: 1,
      customer_notify: 0,
      start_at: Math.floor(o.startAt.getTime() / 1000),
      ...(o.upfrontPaise > 0
        ? { addons: [{ item: { name: o.upfrontName, amount: o.upfrontPaise, currency: 'INR' } }] }
        : {}),
      notes: o.notes,
    });
  },

  async fetchSubscription(id: string): Promise<RzpSubscription | null> {
    if (paymentsMode === 'simulator') return sim.subscriptions.get(id) ?? null;
    return call<RzpSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);
  },

  async subscriptionPayments(id: string): Promise<RzpPayment[]> {
    if (paymentsMode === 'simulator') {
      return (sim.subscriptions.get(id)?.payments ?? []).map((p) => sim.payments.get(p)!);
    }
    // A subscription's charges are paid against its invoices.
    const res = await call<{ items: { payment_id: string | null }[] }>(
      'GET',
      `/invoices?subscription_id=${encodeURIComponent(id)}`,
    );
    const ids = (res.items ?? []).flatMap((i) => (i.payment_id ? [i.payment_id] : []));
    const payments = await Promise.all(ids.map((pid) => gateway.fetchPayment(pid)));
    return payments.filter((p): p is RzpPayment => Boolean(p));
  },

  async cancelSubscription(id: string, atCycleEnd: boolean) {
    if (paymentsMode === 'simulator') {
      const s = sim.subscriptions.get(id);
      if (s) s.status = atCycleEnd ? 'active' : 'cancelled';
      return;
    }
    await call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
      cancel_at_cycle_end: atCycleEnd ? 1 : 0,
    });
  },

  async createQr(o: { amount: number; closeBy: Date; description: string; notes: Record<string, string> }) {
    if (paymentsMode === 'simulator') {
      const qr: SimQr = { id: simId('qr'), amount: o.amount, notes: o.notes, payments: [] };
      sim.qrs.set(qr.id, qr);
      return { id: qr.id, image_url: null as string | null };
    }
    return call<{ id: string; image_url: string | null }>('POST', '/payments/qr_codes', {
      type: 'upi_qr',
      name: 'Nexity',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: o.amount,
      description: o.description,
      close_by: Math.floor(o.closeBy.getTime() / 1000),
      notes: o.notes,
    });
  },

  async qrPayments(qrId: string): Promise<RzpPayment[]> {
    if (paymentsMode === 'simulator') {
      return (sim.qrs.get(qrId)?.payments ?? []).map((id) => sim.payments.get(id)!);
    }
    const res = await call<{ items: RzpPayment[] }>('GET', `/payments/qr_codes/${qrId}/payments`);
    return res.items ?? [];
  },

  async refund(paymentId: string, amount?: number) {
    if (paymentsMode === 'simulator') {
      const p = sim.payments.get(paymentId);
      if (p) {
        p.amount_refunded = amount ?? p.amount;
        p.status = 'refunded';
      }
      return;
    }
    await call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, amount ? { amount } : {});
  },
};

/** Masked display only: never a full UPI id, card number or account number. */
export function methodDisplay(p: RzpPayment) {
  switch (p.method) {
    case 'upi': {
      const handle = p.vpa?.includes('@') ? `@${p.vpa.split('@')[1]}` : '';
      return handle ? `UPI · ${handle}` : 'UPI';
    }
    case 'card': {
      const network = p.card?.network ?? 'Card';
      return p.card?.last4 ? `${network} •••• ${p.card.last4}` : network;
    }
    case 'netbanking':
      return p.bank ? `Net banking · ${p.bank}` : 'Net banking';
    case 'wallet':
      return p.wallet ? `Wallet · ${p.wallet[0]!.toUpperCase()}${p.wallet.slice(1)}` : 'Wallet';
    default:
      return p.method ? p.method.toUpperCase() : null;
  }
}
