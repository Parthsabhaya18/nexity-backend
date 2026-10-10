import { logger } from '../../utils/logger';
import { PLAN_IDS, type PlanId } from '../users/user.model';
import { PlanModel, PlansPage } from './plan.model';

export type PlanLimits = {
  /** -1 = unlimited (the daily fair-use cap still applies), 0 = not allowed. */
  secret_messages_per_month: number;
  secret_messages_per_day_fair_use: number;
  crush_spots: number;
  read_secret: boolean;
  /** "This person was near you today / yesterday." in Secret Messages. */
  nearby: boolean;
  badge: boolean;
};

export const PERIODS = ['monthly', 'quarterly', 'yearly'] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_MONTHS: Record<Period, number> = { monthly: 1, quarterly: 3, yearly: 12 };
/** Paid time per period: months × 30 days (razorpay-payments.md §5.5). */
export const periodMs = (period: Period) => PERIOD_MONTHS[period] * 30 * 86_400_000;

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  rank: number;
  active: boolean;
  price_inr: number;
  mrp_inr: number;
  /** Integer paise, GST included. The only prices the server charges. */
  pricing: Record<Period, number>;
  features: string[];
  missing_features: string[];
  icon: string;
  highlight_label: string | null;
  cta_label: string | null;
  limits: PlanLimits;
};

/** Inserted into the `plans` collection when a plan is missing; the database wins afterwards. */
export const DEFAULT_PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Everything you need to share and connect.',
    rank: 0,
    active: true,
    price_inr: 0,
    mrp_inr: 0,
    pricing: { monthly: 0, quarterly: 0, yearly: 0 },
    features: [
      'Posts, Reels, Stories and Chat',
      'Get notified when someone sends you a Secret Message',
      'See how many sealed messages you have',
    ],
    missing_features: [
      'Send or read Secret Messages',
      'Add Secret Crushes',
      'Nearby hints in Secret Messages & Crush',
    ],
    icon: 'user',
    highlight_label: null,
    cta_label: null,
    limits: {
      secret_messages_per_month: 0,
      secret_messages_per_day_fair_use: 0,
      crush_spots: 0,
      read_secret: false,
      nearby: false,
      badge: false,
    },
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    description: 'Start your secret side.',
    rank: 1,
    active: true,
    price_inr: 99,
    mrp_inr: 149,
    pricing: { monthly: 9900, quarterly: 26700, yearly: 89100 },
    features: [
      'Open & reply to Secret Messages',
      'Send 5 Secret Messages a month',
      'Add up to 3 Secret Crushes',
      'See who was near you today or yesterday',
    ],
    missing_features: [],
    icon: 'sparkles',
    highlight_label: null,
    cta_label: 'Upgrade to Plus',
    limits: {
      secret_messages_per_month: 5,
      secret_messages_per_day_fair_use: 30,
      crush_spots: 3,
      read_secret: true,
      nearby: true,
      badge: false,
    },
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    description: 'More mystery, more crushes, a 👑 badge.',
    rank: 2,
    active: true,
    price_inr: 249,
    mrp_inr: 399,
    pricing: { monthly: 24900, quarterly: 67200, yearly: 224100 },
    features: [
      'Everything in Plus',
      'Unlimited Secret Messages (fair use)',
      'Add up to 10 Secret Crushes',
      'Premium profile badge 👑',
    ],
    missing_features: [],
    icon: 'crown',
    highlight_label: 'Most popular',
    cta_label: 'Get Premium',
    limits: {
      secret_messages_per_month: -1,
      secret_messages_per_day_fair_use: 30,
      crush_spots: 10,
      read_secret: true,
      nearby: true,
      badge: true,
    },
  },
};

const LIMIT_KEYS = Object.keys(DEFAULT_PLANS.free.limits) as (keyof PlanLimits)[];

type CompareRow = { label: string; limit?: keyof PlanLimits | null; values?: Partial<Record<PlanId, string | boolean>> | null };
type IconText = { icon: string; title: string; text: string };

export const PAGE_KEY = 'default';

export const DEFAULT_PAGE = {
  key: PAGE_KEY,
  title: 'Unlock your secret side',
  subtitle: 'Simple plans. Save up to 25% when you pay yearly.',
  current_prefix: "You're on",
  checkout_unavailable_note: 'Payments are not available right now.',
  reasons: {
    'secret-send': {
      icon: 'send',
      title: 'Secret Messages need Plus or Premium',
      text: "Send anonymous messages — you're only revealed after they reply twice.",
    },
    'secret-read': {
      icon: 'mail',
      title: 'Someone is trying to reach you',
      text: 'Upgrade to reply. Their name and message unseal together after your 2nd reply.',
    },
    crush: {
      icon: 'heart',
      title: 'Secret Crush needs Plus or Premium',
      text: "Add your crushes privately. If it's mutual, it's a match.",
    },
    nearby: {
      icon: 'map-pin',
      title: 'See who was near you',
      text: 'Plus and Premium show "This person was near you today." or "yesterday." in Secret Messages and Secret Crush — never a place, time or distance.',
    },
    limit: {
      icon: 'crown',
      title: "You've reached your plan limit",
      text: 'Premium gives unlimited Secret Messages (fair use), up to 10 Secret Crushes and a Premium badge.',
    },
  } as Record<string, IconText>,
  compare_title: 'Compare plans',
  compare_feature_label: 'Feature',
  compare_rows: [
    { label: 'Posts, Reels, Stories & Chat', values: { free: true, plus: true, premium: true } },
    { label: 'Secret notifications', values: { free: true, plus: true, premium: true } },
    { label: 'Send Secret Messages / month', limit: 'secret_messages_per_month' },
    { label: 'Read & reply to Secret Messages', limit: 'read_secret' },
    { label: 'Secret Crush spots', limit: 'crush_spots' },
    { label: 'Match animation & love chat', values: { free: false, plus: true, premium: true } },
    { label: '"Near you today / yesterday"', limit: 'nearby' },
    { label: 'Premium profile badge 👑', limit: 'badge' },
  ] as CompareRow[],
  trust: [
    { icon: 'repeat', title: '', text: 'Monthly, 3-month or yearly' },
    { icon: 'x', title: '', text: 'Cancel anytime' },
    { icon: 'shield-check', title: '', text: 'Secure payment by Razorpay' },
  ] as IconText[],
};

type PageContent = typeof DEFAULT_PAGE;

/**
 * In-memory copy of the `plans` collection so entitlement checks stay synchronous.
 * Mutated in place; `refreshPlans()` reloads it from the database.
 */
export const PLANS: Record<PlanId, Plan> = structuredClone(DEFAULT_PLANS);
let page: PageContent = structuredClone(DEFAULT_PAGE);

const CACHE_TTL_MS = 30_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

function toPlan(doc: Record<string, unknown>, fallback: Plan): Plan {
  const d = doc as Partial<Plan>;
  return {
    id: fallback.id,
    name: d.name ?? fallback.name,
    description: d.description ?? fallback.description,
    rank: d.rank ?? fallback.rank,
    active: d.active ?? true,
    price_inr: d.price_inr ?? fallback.price_inr,
    mrp_inr: d.mrp_inr ?? fallback.mrp_inr,
    pricing: { ...fallback.pricing, ...d.pricing },
    features: d.features ?? [],
    missing_features: d.missing_features ?? [],
    icon: d.icon ?? fallback.icon,
    highlight_label: d.highlight_label ?? null,
    cta_label: d.cta_label ?? null,
    limits: { ...fallback.limits, ...d.limits },
  };
}

async function load() {
  await Promise.all([
    ...PLAN_IDS.map((id) =>
      PlanModel.updateOne({ id }, { $setOnInsert: DEFAULT_PLANS[id] }, { upsert: true }),
    ),
    PlansPage.updateOne({ key: PAGE_KEY }, { $setOnInsert: DEFAULT_PAGE }, { upsert: true }),
  ]);
  const [docs, pageDoc] = await Promise.all([
    PlanModel.find({ id: { $in: PLAN_IDS } }).lean(),
    PlansPage.findOne({ key: PAGE_KEY }).lean(),
  ]);
  for (const doc of docs) {
    const id = doc.id as PlanId;
    PLANS[id] = toPlan(doc as Record<string, unknown>, DEFAULT_PLANS[id]);
  }
  if (pageDoc) {
    const p = pageDoc as unknown as Partial<PageContent> & { reasons?: unknown };
    const reasons = p.reasons instanceof Map ? Object.fromEntries(p.reasons) : p.reasons;
    page = {
      ...DEFAULT_PAGE,
      ...p,
      key: PAGE_KEY,
      reasons: (reasons as Record<string, IconText> | undefined) ?? {},
      compare_rows: (p.compare_rows as CompareRow[] | undefined) ?? [],
      trust: (p.trust as IconText[] | undefined) ?? [],
    };
  }
  loadedAt = Date.now();
}

/** Reloads plans and page copy from MongoDB (seeding missing defaults). `force` skips the cache. */
export async function refreshPlans(force = false) {
  if (!force && Date.now() - loadedAt < CACHE_TTL_MS) return;
  inflight ??= load()
    .catch((err) => {
      logger.error({ err }, 'Could not load plans; using the last known copy');
    })
    .finally(() => {
      inflight = null;
    });
  await inflight;
}

const cell = (key: keyof PlanLimits, plan: Plan): string | boolean => {
  const v = plan.limits[key];
  if (typeof v === 'boolean') return v;
  return v < 0 ? 'Unlimited' : v === 0 ? false : String(v);
};

/** Plans screen copy; comparison cells tied to a limit are read from the live plans. */
export function plansPageDto(planIds: PlanId[]) {
  const rows = page.compare_rows.map((row) => {
    const limit = row.limit && LIMIT_KEYS.includes(row.limit) ? row.limit : null;
    const cells = Object.fromEntries(
      planIds.map((id) => [id, limit ? cell(limit, PLANS[id]) : (row.values?.[id] ?? false)]),
    ) as Record<PlanId, string | boolean>;
    return { label: row.label, cells };
  });
  return {
    title: page.title,
    subtitle: page.subtitle,
    current_prefix: page.current_prefix,
    checkout_unavailable_note: page.checkout_unavailable_note,
    reasons: page.reasons,
    compare: { title: page.compare_title, feature_label: page.compare_feature_label, rows },
    trust: page.trust.map(({ icon, text }) => ({ icon, text })),
  };
}
