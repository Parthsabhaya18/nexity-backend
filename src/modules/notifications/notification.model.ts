import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

export const NOTIFICATION_TYPES = ['comment_post', 'comment_reel'] as const;

const notificationSchema = new mongoose.Schema(
  {
    recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    text: { type: String, required: true, maxlength: 300 },
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    reel_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', default: null },
    comment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    read_at: { type: Date, default: null },
  },
  {
    collection: 'notifications',
    timestamps: { createdAt: 'created_at', updatedAt: false } as const,
  },
);

notificationSchema.index({ recipient_id: 1, _id: -1 });
notificationSchema.index({ recipient_id: 1, read_at: 1 });

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = mongoose.model('Notification', notificationSchema);
