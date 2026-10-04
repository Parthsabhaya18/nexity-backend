import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

const blockSchema = new mongoose.Schema(
  {
    blocker_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    blocked_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'blocks',
    timestamps: { createdAt: 'created_at', updatedAt: false } as const,
  },
);

blockSchema.index({ blocker_id: 1, blocked_id: 1 }, { unique: true });
blockSchema.index({ blocked_id: 1, blocker_id: 1 });

export type BlockDoc = HydratedDocument<InferSchemaType<typeof blockSchema>>;
export const Block = mongoose.model('Block', blockSchema);
