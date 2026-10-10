import mongoose, { type InferSchemaType } from 'mongoose';

import { PLAN_IDS } from '../users/user.model';

const limitsSchema = new mongoose.Schema(
  {
    secret_messages_per_month: { type: Number, required: true },
    secret_messages_per_day_fair_use: { type: Number, required: true },
    crush_spots: { type: Number, required: true },
    read_secret: { type: Boolean, required: true },
    nearby: { type: Boolean, required: true },
    badge: { type: Boolean, required: true },
  },
  { _id: false },
);

/** Admin-editable plan catalog (plans-and-billing.md §1.3). Prices are integer paise, GST included. */
const planSchema = new mongoose.Schema(
  {
    id: { type: String, enum: PLAN_IDS, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    rank: { type: Number, required: true },
    active: { type: Boolean, default: true },
    price_inr: { type: Number, required: true, min: 0 },
    mrp_inr: { type: Number, required: true, min: 0 },
    pricing: {
      monthly: { type: Number, required: true, min: 0 },
      quarterly: { type: Number, required: true, min: 0 },
      yearly: { type: Number, required: true, min: 0 },
    },
    features: { type: [String], default: [] },
    /** Shown crossed out on the card ("what you don't get"). */
    missing_features: { type: [String], default: [] },
    /** Icon key the app maps to a glyph: `user`, `sparkles`, `crown`, … */
    icon: { type: String, default: 'user' },
    /** Ribbon text such as "Most popular"; the plan gets the highlighted card. */
    highlight_label: { type: String, default: null },
    cta_label: { type: String, default: null },
    limits: { type: limitsSchema, required: true },
  },
  {
    collection: 'plans',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

export type PlanAttrs = InferSchemaType<typeof planSchema>;
export const PlanModel = mongoose.model('Plan', planSchema);

const iconTextSchema = new mongoose.Schema(
  { icon: { type: String, default: 'info' }, title: { type: String, default: '' }, text: { type: String, required: true } },
  { _id: false },
);

const compareRowSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    /** Reads the cell from `plans[].limits[limit]`, so the table follows limit edits. */
    limit: { type: String, default: null },
    /** Fixed cells per plan id when `limit` is not set: `true` / `false` or text. */
    values: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

/** Copy for the Plans screen; one document per `key`. */
const plansPageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    current_prefix: { type: String, default: "You're on" },
    checkout_unavailable_note: { type: String, default: '' },
    reasons: { type: Map, of: iconTextSchema, default: {} },
    compare_title: { type: String, default: 'Compare plans' },
    compare_feature_label: { type: String, default: 'Feature' },
    compare_rows: { type: [compareRowSchema], default: [] },
    trust: { type: [iconTextSchema], default: [] },
  },
  {
    collection: 'plan_page',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

export type PlansPageAttrs = InferSchemaType<typeof plansPageSchema>;
export const PlansPage = mongoose.model('PlansPage', plansPageSchema);
