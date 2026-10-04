import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

export const FOLLOW_STATUSES = ['pending', 'accepted'] as const;

/** `pending` is a request to a private account; only `accepted` counts as following. */
const followSchema = new mongoose.Schema(
  {
    follower_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    following_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: FOLLOW_STATUSES, required: true },
  },
  {
    collection: 'follows',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

followSchema.index({ follower_id: 1, following_id: 1 }, { unique: true });
followSchema.index({ following_id: 1, status: 1, _id: -1 });
followSchema.index({ follower_id: 1, status: 1, _id: -1 });

export type FollowAttrs = InferSchemaType<typeof followSchema>;
export type FollowDoc = HydratedDocument<FollowAttrs>;

export const Follow = mongoose.model('Follow', followSchema);
