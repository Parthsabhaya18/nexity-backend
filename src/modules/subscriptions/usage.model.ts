import mongoose, { type InferSchemaType } from 'mongoose';

/** New Secret Message threads per period: `m:2026-10` (month) or `d:2026-10-07` (fair-use day), Asia/Kolkata. */
const secretUsageSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    period: { type: String, required: true },
    count: { type: Number, default: 0, min: 0 },
  },
  {
    collection: 'secret_usage',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

secretUsageSchema.index({ user_id: 1, period: 1 }, { unique: true });

export type SecretUsageAttrs = InferSchemaType<typeof secretUsageSchema>;
export const SecretUsage = mongoose.model('SecretUsage', secretUsageSchema);
