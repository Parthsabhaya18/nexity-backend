import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const CRUSH_STATUSES = ['active', 'paused', 'matched', 'removed'] as const;
export type CrushStatus = (typeof CRUSH_STATUSES)[number];

/** One row per (adder, person). Removing keeps the row for the 24 h re-add cooldown. */
const crushSchema = new mongoose.Schema(
  {
    from_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: CRUSH_STATUSES, default: 'active' },
    match_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CrushMatch', default: null },
    added_at: { type: Date, required: true },
    removed_at: { type: Date, default: null },
    /** Last "Someone added you" notice for this pair (max one per 30 days). */
    notified_at: { type: Date, default: null },
  },
  {
    collection: 'crushes',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

crushSchema.index({ from_user_id: 1, to_user_id: 1 }, { unique: true });
crushSchema.index({ to_user_id: 1, status: 1 });
crushSchema.index({ from_user_id: 1, status: 1, added_at: 1 });

export type CrushAttrs = InferSchemaType<typeof crushSchema> & {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
};
export const Crush = mongoose.model('Crush', crushSchema);

/** Exactly one per pair: `pair_key` is unique, so two people adding each other at once can't create two. */
const crushMatchSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true },
    pair_key: { type: String, required: true },
    user_ids: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
    },
    conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    matched_at: { type: Date, required: true },
    /** Users who have seen the celebration. */
    celebrated_by: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
  },
  {
    collection: 'crush_matches',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

crushMatchSchema.index({ public_id: 1 }, { unique: true });
crushMatchSchema.index({ pair_key: 1 }, { unique: true });
crushMatchSchema.index({ user_ids: 1, matched_at: -1 });

export type CrushMatchAttrs = InferSchemaType<typeof crushMatchSchema> & {
  _id: Types.ObjectId;
};
export const CrushMatch = mongoose.model('CrushMatch', crushMatchSchema);

/**
 * The admirer count people see. It rises live but only falls at the next 00:00 IST, so a drop
 * can't be timed to one person removing you.
 */
const admirerCountSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    count: { type: Number, default: 0, min: 0 },
    recomputed_at: { type: Date, required: true },
  },
  { collection: 'crush_admirer_counts' },
);

admirerCountSchema.index({ user_id: 1 }, { unique: true });

export const CrushAdmirerCount = mongoose.model('CrushAdmirerCount', admirerCountSchema);
