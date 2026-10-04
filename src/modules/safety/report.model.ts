import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

export const REPORT_TARGETS = ['post', 'reel', 'story', 'user', 'message', 'comment'] as const;
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'nudity',
  'violence',
  'self_harm',
  'other',
] as const;

const reportSchema = new mongoose.Schema(
  {
    reporter_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    target_type: { type: String, enum: REPORT_TARGETS, required: true },
    target_id: { type: String, required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  },
  {
    collection: 'reports',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

reportSchema.index({ reporter_id: 1, target_type: 1, target_id: 1 }, { unique: true });
reportSchema.index({ status: 1, _id: -1 });

export type ReportDoc = HydratedDocument<InferSchemaType<typeof reportSchema>>;
export const Report = mongoose.model('Report', reportSchema);
