import { randomUUID } from 'node:crypto';

import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/modules/media/media.storage', () => ({
  abortMultipartUpload: vi.fn(async () => {}),
  deleteObjects: vi.fn(async () => {}),
  publicUrl: (key: string) => `https://cdn.test/${key}`,
  viewUrl: async (key: string) => `https://cdn.test/${key}`,
}));

import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { OtpCode } from '../src/modules/auth/otpCode.model';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { Conversation } from '../src/modules/messages/conversation.model';
import { Message } from '../src/modules/messages/message.model';
import { pairKeyOf } from '../src/modules/nearby/nearby.encounters';
import { Encounter } from '../src/modules/nearby/nearby.models';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  CouponRedemption,
  Payment,
  PaymentCheckout,
  PaymentWebhookEvent,
} from '../src/modules/payments/payment.models';
import { runPaymentsJob } from '../src/modules/payments/payments.service';
import {
  hmacHex,
  simulateRenewalPayment,
  simulateSubscriptionStatus,
  webhookSecret,
} from '../src/modules/payments/razorpay.gateway';
import { PlanModel } from '../src/modules/subscriptions/plan.model';
import { refreshPlans } from '../src/modules/subscriptions/plans';
import { Crush, CrushAdmirerCount, CrushMatch } from '../src/modules/secret-crush/crush.models';
import { User } from '../src/modules/users/user.model';

let mongo: MongoMemoryServer;
const app = createApp();

type Account = { auth: string; id: string; username: string };

async function signUp(username: string): Promise<Account> {
  const email = `${username}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    display_name: username,
    username,
    email,
    password: 'secretPass1',
    gender: 'woman',
    date_of_birth: '1998-04-12',
    accept_terms: true,
  });
  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ email, code: reg.body.dev_code });
  return {
    auth: `Bearer ${verified.body.access_token as string}`,
    id: verified.body.user.id as string,
    username,
  };
}

const api = (a: Account, platform = 'android') => ({
  get: (path: string) =>
    request(app).get(`/api/v1${path}`).set('Authorization', a.auth).set('X-Platform', platform),
  post: (path: string, body?: object, headers: Record<string, string> = {}) =>
    request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', a.auth)
      .set('X-Platform', platform)
      .set(headers)
      .send(body ?? {}),
  patch: (path: string, body?: object) =>
    request(app)
      .patch(`/api/v1${path}`)
      .set('Authorization', a.auth)
      .set('X-Platform', platform)
      .send(body ?? {}),
});

type Opts = {
  plan?: 'plus' | 'premium';
  period?: 'monthly' | 'quarterly' | 'yearly';
  autopay?: boolean;
  coupon?: string;
  method?: 'upi' | 'qr' | 'card' | 'netbanking' | 'wallet';
  key?: string;
};

const checkout = (a: Account, o: Opts = {}, platform = 'android') =>
  api(a, platform).post(
    '/payments/checkout',
    {
      plan_id: o.plan ?? 'plus',
      period: o.period ?? 'monthly',
      autopay: o.autopay ?? false,
      ...(o.coupon ? { coupon_code: o.coupon } : {}),
      method: o.method ?? 'upi',
    },
    { 'Idempotency-Key': o.key ?? randomUUID() },
  );

const simulate = (a: Account, checkoutId: string, extra: object = {}) =>
  api(a).post('/payments/dev/simulate', {
    checkout_id: checkoutId,
    outcome: 'success',
    method: 'upi',
    ...extra,
  });

/** Checkout → Razorpay sheet (simulated) → /verify, like the app does. */
async function buy(a: Account, o: Opts = {}, platform = 'android') {
  const c = await checkout(a, o, platform);
  expect(c.status).toBe(201);
  const paid = await simulate(a, c.body.checkout_id, o.method === 'card' ? { method: 'card' } : {});
  const v = await api(a, platform).post('/payments/verify', { checkout_id: c.body.checkout_id, ...paid.body });
  return { checkout: c.body, verify: v };
}

function webhook(body: object, eventId = randomUUID()) {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/v1/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', hmacHex(raw, webhookSecret()!))
    .set('X-Razorpay-Event-Id', eventId)
    .send(raw);
}

const me = async (a: Account) => (await api(a).get('/subscriptions/me')).body;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    OtpCode.deleteMany({}),
    RefreshToken.deleteMany({}),
    Notification.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    Crush.deleteMany({}),
    CrushMatch.deleteMany({}),
    CrushAdmirerCount.deleteMany({}),
    Encounter.deleteMany({}),
    PaymentCheckout.deleteMany({}),
    Payment.deleteMany({}),
    PaymentWebhookEvent.deleteMany({}),
    CouponRedemption.deleteMany({}),
  ]);
});

describe('plans & quotes', () => {
  it('lists server prices and allows the same Razorpay checkout on iOS', async () => {
    const alice = await signUp('alice');
    const plans = await api(alice).get('/plans');
    expect(plans.body.checkout_available).toBe(true);
    expect(plans.body.payments.mode).toBe('simulator');
    const premium = plans.body.data.find((p: { id: string }) => p.id === 'premium');
    expect(premium.pricing.monthly.amount_paise).toBe(24900);
    expect(premium.pricing.yearly).toMatchObject({ amount_paise: 224100, save_pct: 25 });

    const ios = await api(alice, 'ios').get('/plans');
    expect(ios.body.checkout_available).toBe(true);
    const bought = await buy(alice, { autopay: true }, 'ios');
    expect(bought.checkout.type).toBe('subscription');
    expect(bought.verify.body.status).toBe('paid');
    expect(bought.verify.body.subscription).toMatchObject({ plan: 'plus', status: 'active' });

    const blocked = await api(alice, 'windows').post(
      '/payments/checkout',
      { plan_id: 'premium', period: 'monthly', autopay: false },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PAYMENT_PROVIDER_NOT_AVAILABLE');
  });

  it('computes every plan × period, coupons and their errors on the server', async () => {
    const alice = await signUp('alice');
    const table = {
      plus: { monthly: 9900, quarterly: 26700, yearly: 89100 },
      premium: { monthly: 24900, quarterly: 67200, yearly: 224100 },
    } as const;
    for (const plan of ['plus', 'premium'] as const) {
      for (const period of ['monthly', 'quarterly', 'yearly'] as const) {
        const q = await api(alice).post('/payments/quote', { plan_id: plan, period, autopay: true });
        expect(q.status).toBe(200);
        expect(q.body.amount_paise).toBe(table[plan][period]);
        expect(q.body.renewal_paise).toBe(table[plan][period]);
      }
    }
    const coupon = await api(alice).post('/payments/quote', {
      plan_id: 'premium',
      period: 'monthly',
      autopay: true,
      coupon_code: 'nexity20',
    });
    expect(coupon.body.coupon).toMatchObject({ code: 'NEXITY20', off_paise: 4980 });
    expect(coupon.body.amount_paise).toBe(19920);
    // Renewals are always full price.
    expect(coupon.body.renewal_paise).toBe(24900);

    const bad = await api(alice).post('/payments/quote', {
      plan_id: 'plus',
      period: 'monthly',
      autopay: false,
      coupon_code: 'FREEMONEY',
    });
    expect(bad.body.error.code).toBe('COUPON_INVALID');
    const free = await api(alice).post('/payments/quote', { plan_id: 'free', period: 'monthly', autopay: false });
    expect(free.body.error.code).toBe('PLAN_NOT_AVAILABLE');
    const qrAutopay = await api(alice).post('/payments/quote', {
      plan_id: 'plus',
      period: 'monthly',
      autopay: true,
      method: 'qr',
    });
    expect(qrAutopay.body.error.code).toBe('METHOD_NOT_FOR_AUTOPAY');
    // The app can never send an amount.
    const amount = await api(alice).post('/payments/quote', {
      plan_id: 'plus',
      period: 'monthly',
      autopay: false,
      amount_paise: 100,
    });
    expect(amount.status).toBe(400);
  });

  it('WELCOME50 is first purchase only and a coupon works once per person', async () => {
    const alice = await signUp('alice');
    const first = await buy(alice, { coupon: 'WELCOME50' });
    expect(first.checkout.amount_paise).toBe(4950);
    expect(first.verify.body.status).toBe('paid');
    const again = await api(alice).post('/payments/quote', {
      plan_id: 'premium',
      period: 'monthly',
      autopay: false,
      coupon_code: 'WELCOME50',
    });
    expect(again.body.error.code).toBe('COUPON_FIRST_PURCHASE_ONLY');
    await buy(alice, { plan: 'premium', coupon: 'NEXITY20' });
    const reuse = await api(alice).post('/payments/quote', {
      plan_id: 'premium',
      period: 'monthly',
      autopay: false,
      coupon_code: 'NEXITY20',
    });
    expect(reuse.body.error.code).toBe('COUPON_LIMIT_REACHED');
  });
});

describe('one-time payments', () => {
  it('UPI payment unlocks Secret Messages, Secret Crush and Nearby hints', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bobby1');
    // Free: both features are locked.
    const lockedMsg = await api(alice).post('/secret-messages', {
      recipient_id: bob.id,
      body: 'Honestly, I admire you a lot',
      client_message_id: randomUUID(),
    });
    expect(lockedMsg.body.error.code).toBe('PLAN_REQUIRED');
    const lockedCrush = await api(alice).post('/secret-crushes', { user_id: bob.id });
    expect(lockedCrush.body.error.code).toBe('PLAN_REQUIRED');

    const { checkout: c, verify } = await buy(alice);
    expect(c.type).toBe('order');
    expect(c.razorpay.order_id).toMatch(/^order_/);
    expect(c.razorpay.amount).toBe(9900);
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe('paid');
    expect(verify.body.subscription).toMatchObject({ plan: 'plus', status: 'active' });
    expect(verify.body.subscription.billing).toMatchObject({
      source: 'razorpay',
      autopay: false,
      method_display: 'UPI · @razorpay',
    });

    const sent = await api(alice).post('/secret-messages', {
      recipient_id: bob.id,
      body: 'Honestly, I admire you a lot',
      client_message_id: randomUUID(),
    });
    expect(sent.status).toBe(201);
    const crush = await api(alice).post('/secret-crushes', { user_id: bob.id });
    expect(crush.status).toBe(201);

    // Nearby hint shows on the paid plan.
    const now = new Date();
    const pair = pairKeyOf(alice.id, bob.id);
    await Encounter.create({
      pair_key: pair,
      participant_a: pair.split(':')[0],
      participant_b: pair.split(':')[1],
      detected_at: now,
      last_detected_at: now,
      source: 'location',
      validation_status: 'verified',
      expires_at: new Date(now.getTime() + 2 * 86_400_000),
    });
    for (const a of [alice, bob]) {
      await api(a).patch('/nearby/settings', { enabled: true, location_enabled: true, timezone: 'Asia/Kolkata' });
    }
    const crushes = await api(alice).get('/secret-crushes');
    expect(crushes.body.data[0].nearby_hint.state).toBe('today');

    const history = await api(alice).get('/payments/history');
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({ amount_paise: 9900, status: 'paid' });
    const notes = await Notification.find({ type: 'subscription_activated' });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toMatch(/Plus plan is active until/);
  });

  it('rejects a forged signature and never activates', async () => {
    const alice = await signUp('alice');
    const c = await checkout(alice);
    const paid = await simulate(alice, c.body.checkout_id);
    const forged = await api(alice).post('/payments/verify', {
      checkout_id: c.body.checkout_id,
      ...paid.body,
      razorpay_signature: 'a'.repeat(64),
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    expect((await me(alice)).plan).toBe('free');
  });

  it('refunds and refuses a payment of a different amount (tampered client)', async () => {
    const alice = await signUp('alice');
    const c = await checkout(alice, { plan: 'premium' });
    const paid = await simulate(alice, c.body.checkout_id, { amount_paise: 100 });
    const v = await api(alice).post('/payments/verify', { checkout_id: c.body.checkout_id, ...paid.body });
    expect(v.body.status).toBe('amount_mismatch');
    expect((await me(alice)).plan).toBe('free');
    expect(await Payment.countDocuments()).toBe(0);
  });

  it("can't reuse someone else's payment id", async () => {
    const alice = await signUp('alice');
    const mallory = await signUp('mallory');
    const a = await buy(alice);
    expect(a.verify.body.status).toBe('paid');
    const paymentId = (await Payment.findOne())!.razorpay_payment_id;
    const m = await checkout(mallory);
    const replay = await api(mallory).post('/payments/verify', {
      checkout_id: m.body.checkout_id,
      razorpay_payment_id: paymentId,
      razorpay_order_id: m.body.razorpay.order_id,
      razorpay_signature: hmacHex(`${m.body.razorpay.order_id}|${paymentId}`, 'wrong-secret'),
    });
    expect(replay.status).toBe(400);
    // Someone else's checkout id is simply not found.
    const steal = await api(mallory).post('/payments/verify', {
      checkout_id: a.checkout.checkout_id,
      razorpay_payment_id: paymentId,
      razorpay_signature: 'b'.repeat(64),
    });
    expect(steal.status).toBe(404);
    expect((await me(mallory)).plan).toBe('free');
  });

  it('parallel /verify calls and a webhook activate exactly once', async () => {
    const alice = await signUp('alice');
    const c = await checkout(alice);
    const paid = await simulate(alice, c.body.checkout_id);
    const body = { checkout_id: c.body.checkout_id, ...paid.body };
    const results = await Promise.all([
      api(alice).post('/payments/verify', body),
      api(alice).post('/payments/verify', body),
      api(alice).post('/payments/verify', body),
    ]);
    for (const r of results) expect(r.body.status).toBe('paid');
    await webhook({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paid.body.razorpay_payment_id,
            amount: 9900,
            currency: 'INR',
            status: 'captured',
            order_id: c.body.razorpay.order_id,
            method: 'upi',
          },
        },
      },
    });
    expect(await Payment.countDocuments()).toBe(1);
    expect(await Notification.countDocuments({ type: 'subscription_activated' })).toBe(1);
  });

  it('a retry with the same Idempotency-Key returns the same checkout', async () => {
    const alice = await signUp('alice');
    const key = randomUUID();
    const one = await checkout(alice, { key });
    const two = await checkout(alice, { key });
    expect(two.body.checkout_id).toBe(one.body.checkout_id);
    const missing = await api(alice).post('/payments/checkout', {
      plan_id: 'plus',
      period: 'monthly',
      autopay: false,
    });
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('a declined payment shows failed and keeps the user on Free', async () => {
    const alice = await signUp('alice');
    const c = await checkout(alice, { method: 'card' });
    const res = await simulate(alice, c.body.checkout_id, { outcome: 'failure', method: 'card' });
    expect(res.body.error).toMatch(/declined/);
    const status = await api(alice).get(`/payments/checkouts/${c.body.checkout_id as string}`);
    expect(status.body.status).toBe('failed');
    expect((await me(alice)).plan).toBe('free');
    const history = await api(alice).get('/payments/history');
    expect(history.body.items[0].status).toBe('failed');
  });

  it('app killed after paying: polling (or the webhook) still activates the plan', async () => {
    const alice = await signUp('alice');
    const c = await checkout(alice, { plan: 'premium', period: 'yearly' });
    await simulate(alice, c.body.checkout_id);
    // No /verify. Next app start asks for pending checkouts; the server checks Razorpay.
    await api(alice).get('/payments/checkouts/pending');
    const status = await api(alice).get(`/payments/checkouts/${c.body.checkout_id as string}`);
    expect(status.body.status).toBe('paid');
    const sub = await me(alice);
    expect(sub.plan).toBe('premium');
    const days = (new Date(sub.current_period_end).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(360);
  });

  it('Scan QR: one-time only, paid from another phone, found by polling', async () => {
    const alice = await signUp('alice');
    const auto = await checkout(alice, { autopay: true, method: 'qr' });
    expect(auto.body.error.code).toBe('METHOD_NOT_FOR_AUTOPAY');
    const c = await checkout(alice, { method: 'qr' });
    const qr = await api(alice).post('/payments/qr', { checkout_id: c.body.checkout_id });
    expect(qr.status).toBe(200);
    expect(qr.body.qr.close_by).toBeTruthy();
    expect((await api(alice).get(`/payments/checkouts/${c.body.checkout_id as string}`)).body.status).toBe(
      'created',
    );
    await simulate(alice, c.body.checkout_id);
    const status = await api(alice).get(`/payments/checkouts/${c.body.checkout_id as string}`);
    expect(status.body.status).toBe('paid');
    expect((await me(alice)).plan).toBe('plus');
  });
});

describe('AutoPay', () => {
  it('first payment, renewal webhook, duplicate and unsigned webhooks', async () => {
    const alice = await signUp('alice');
    const { checkout: c, verify } = await buy(alice, { plan: 'premium', autopay: true, method: 'card' });
    expect(c.type).toBe('subscription');
    expect(c.razorpay.subscription_id).toMatch(/^sub_/);
    expect(verify.body.status).toBe('paid');
    const sub = verify.body.subscription;
    expect(sub.billing).toMatchObject({ autopay: true, price_paise: 24900, method_display: 'Visa •••• 1111' });
    expect(sub.billing.next_charge_at).toBe(sub.current_period_end);

    const renewal = simulateRenewalPayment(c.razorpay.subscription_id, 24900);
    const event = {
      event: 'subscription.charged',
      payload: {
        subscription: { entity: { id: c.razorpay.subscription_id, plan_id: 'x', status: 'active' } },
        payment: { entity: renewal },
      },
    };
    const eventId = randomUUID();
    const first = await webhook(event, eventId);
    expect(first.body.status).toBe('processed');
    const dup = await webhook(event, eventId);
    expect(dup.body.status).toBe('duplicate');
    const after = await me(alice);
    const gained = new Date(after.current_period_end).getTime() - new Date(sub.current_period_end).getTime();
    expect(Math.round(gained / 86_400_000)).toBe(30);
    expect(await Payment.countDocuments({ kind: 'renewal' })).toBe(1);
    expect(await Notification.countDocuments({ type: 'payment_renewed' })).toBe(1);

    const unsigned = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'deadbeef')
      .send(JSON.stringify(event));
    expect(unsigned.status).toBe(400);
  });

  it('cancel keeps the plan until the end; resume needs only a mandate', async () => {
    const alice = await signUp('alice');
    await buy(alice, { autopay: true });
    const cancelled = await api(alice).post('/subscriptions/me/cancel');
    expect(cancelled.body.billing).toMatchObject({ autopay: false, cancel_at_period_end: true });
    expect(cancelled.body.plan).toBe('plus');

    const resume = await api(alice).post('/subscriptions/me/resume', {}, { 'Idempotency-Key': randomUUID() });
    expect(resume.status).toBe(201);
    expect(resume.body.type).toBe('mandate');
    expect(resume.body.amount_paise).toBe(0);
    const paid = await simulate(alice, resume.body.checkout_id);
    const v = await api(alice).post('/payments/verify', { checkout_id: resume.body.checkout_id, ...paid.body });
    expect(v.body.status).toBe('paid');
    expect(v.body.subscription.billing).toMatchObject({ autopay: true, cancel_at_period_end: false });
  });

  it('failed renewal: grace, then halted moves to Free and pauses crushes; paying again restores them', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bobby2');
    const { checkout: c } = await buy(alice, { autopay: true });
    await api(alice).post('/secret-crushes', { user_id: bob.id });
    const subEntity = { id: c.razorpay.subscription_id, plan_id: 'x', status: 'pending' };

    simulateSubscriptionStatus(c.razorpay.subscription_id, 'pending');
    await webhook({ event: 'subscription.pending', payload: { subscription: { entity: subEntity } } });
    const grace = await me(alice);
    expect(grace.plan).toBe('plus');
    expect(grace.billing.status).toBe('in_grace');

    simulateSubscriptionStatus(c.razorpay.subscription_id, 'halted');
    await webhook({ event: 'subscription.halted', payload: { subscription: { entity: subEntity } } });
    expect((await me(alice)).plan).toBe('free');
    expect((await Crush.findOne())!.status).toBe('paused');

    // Bob adds Alice; it matches as soon as Alice pays again.
    await buy(bob);
    await api(bob).post('/secret-crushes', { user_id: alice.id });
    expect(await CrushMatch.countDocuments()).toBe(0);
    await buy(alice);
    expect(await CrushMatch.countDocuments()).toBe(1);
  });
});

describe('upgrades', () => {
  it('Plus → Premium charges only the pro-rated difference and cancels the old AutoPay', async () => {
    const alice = await signUp('alice');
    await buy(alice, { autopay: true });
    const q = await api(alice).post('/payments/quote', { plan_id: 'premium', period: 'monthly', autopay: true });
    expect(q.body.kind).toBe('upgrade');
    // Almost the whole Plus month is unused: ₹99 credit, rounded down to the rupee.
    expect(q.body.credit_paise).toBe(9800);
    expect(q.body.amount_paise).toBe(24900 - 9800);
    const up = await buy(alice, { plan: 'premium', autopay: true });
    expect(up.verify.body.subscription.plan).toBe('premium');
    expect(up.verify.body.subscription.billing.price_paise).toBe(24900);

    const down = await api(alice).post('/payments/quote', { plan_id: 'plus', period: 'monthly', autopay: false });
    expect(down.body.error.code).toBe('PLAN_DOWNGRADE_LATER');
    const same = await api(alice).post('/payments/quote', { plan_id: 'premium', period: 'monthly', autopay: true });
    expect(same.body.error.code).toBe('ALREADY_ON_PLAN');
  });

  it('paying again for a one-time plan adds a period after the current one', async () => {
    const alice = await signUp('alice');
    await buy(alice);
    const first = new Date((await me(alice)).current_period_end).getTime();
    await buy(alice);
    const second = new Date((await me(alice)).current_period_end).getTime();
    expect(Math.round((second - first) / 86_400_000)).toBe(30);
  });
});

describe('payments job', () => {
  it('reminds before a one-time plan ends, then moves to Free and pauses crushes', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bobby3');
    await buy(alice);
    await api(alice).post('/secret-crushes', { user_id: bob.id });
    const end = new Date((await me(alice)).current_period_end);

    await runPaymentsJob(new Date(end.getTime() - 2 * 86_400_000));
    await runPaymentsJob(new Date(end.getTime() - 2 * 86_400_000));
    expect(await Notification.countDocuments({ type: 'subscription_expiring' })).toBe(1);

    await runPaymentsJob(new Date(end.getTime() + 1000));
    expect((await me(alice)).plan).toBe('free');
    expect((await Crush.findOne())!.status).toBe('paused');
    expect(await Notification.countDocuments({ type: 'subscription_expired' })).toBe(1);
  });
});

describe('payment integrity', () => {
  it('a signed callback for a payment Razorpay never took does not activate a plan', async () => {
    const alice = await signUp('alice');
    const c = await checkout(alice, { plan: 'premium' });
    const fakePay = 'pay_fake_hacker';
    const forged = await api(alice).post('/payments/verify', {
      checkout_id: c.body.checkout_id,
      razorpay_payment_id: fakePay,
      razorpay_order_id: c.body.razorpay.order_id,
      razorpay_signature: hmacHex(`${c.body.razorpay.order_id}|${fakePay}`, webhookSecret()!),
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('PAYMENT_NOT_FOUND');
    expect((await me(alice)).plan).toBe('free');

    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: fakePay,
            amount: 24900,
            currency: 'INR',
            status: 'captured',
            order_id: c.body.razorpay.order_id,
            method: 'upi',
          },
        },
      },
    });
    const hooked = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', hmacHex(raw, webhookSecret()!))
      .set('X-Razorpay-Event-Id', randomUUID())
      .send(raw);
    expect(hooked.body.status).toBe('ignored');
    expect((await me(alice)).plan).toBe('free');
    expect(await Payment.countDocuments()).toBe(0);
  });

  it('a halted webhook is ignored unless Razorpay itself halted the subscription', async () => {
    const alice = await signUp('alice');
    const { checkout: c } = await buy(alice, { autopay: true });
    const lying = await webhook({
      event: 'subscription.halted',
      payload: {
        subscription: { entity: { id: c.razorpay.subscription_id, plan_id: 'x', status: 'halted' } },
      },
    });
    expect(lying.body.status).toBe('ignored');
    expect((await me(alice)).plan).toBe('plus');
  });

  it('a changed catalog price is what the next checkout charges, and a downgrade waits until the plan ends', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bobby4');
    await PlanModel.updateOne({ id: 'plus' }, { $set: { 'pricing.monthly': 14900, 'limits.crush_spots': 1 } });
    await refreshPlans(true);
    try {
      const plans = await api(alice).get('/plans');
      const plus = plans.body.data.find((p: { id: string }) => p.id === 'plus');
      expect(plus.pricing.monthly.amount_paise).toBe(14900);

      const bought = await buy(alice);
      expect(bought.checkout.amount_paise).toBe(14900);
      expect((await me(alice)).plan).toBe('plus');

      const sent = await api(alice).post('/secret-messages', {
        recipient_id: bob.id,
        body: 'Still sealed after the new price',
        client_message_id: randomUUID(),
      });
      expect(sent.status).toBe(201);
      await api(alice).post('/secret-crushes', { user_id: bob.id });
      const second = await api(alice).post('/secret-crushes', { user_id: (await signUp('bobby5')).id });
      expect(second.body.error.code).toBe('PLAN_LIMIT_REACHED');

      const down = await api(alice).post('/payments/quote', { plan_id: 'plus', period: 'monthly', autopay: false });
      expect(down.status).not.toBe(409);
      await buy(alice, { plan: 'premium' });
      const blocked = await api(alice).post('/payments/quote', { plan_id: 'plus', period: 'monthly', autopay: false });
      expect(blocked.body.error.code).toBe('PLAN_DOWNGRADE_LATER');

      const end = new Date((await me(alice)).current_period_end);
      await runPaymentsJob(new Date(end.getTime() + 1000));
      expect((await me(alice)).plan).toBe('free');
      const locked = await api(alice).post('/secret-messages', {
        recipient_id: bob.id,
        body: 'This one should lock',
        client_message_id: randomUUID(),
      });
      expect(locked.body.error.code).toBe('PLAN_REQUIRED');
      const again = await buy(alice);
      expect(again.verify.body.subscription.plan).toBe('plus');
      expect(again.checkout.amount_paise).toBe(14900);
    } finally {
      await PlanModel.updateOne(
        { id: 'plus' },
        { $set: { 'pricing.monthly': 9900, 'limits.crush_spots': 3 } },
      );
      await refreshPlans(true);
    }
  });
});
