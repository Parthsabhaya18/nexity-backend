import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'comment_post',
  'comment_reel',
  'story_like',
  'story_reply',
  /** Anonymous: stored without an actor. */
  'secret_message_received',
  'secret_message_followup',
  'secret_message_reply',
  'secret_message_revealed',
  /** Generic "Someone is near you on Nexity. ✨" — never names the other person. */
  'nearby_encounter',
  /** Anonymous: "Someone added you as a Secret Crush 👀". */
  'crush_added',
  'crush_match',
  /** Plans & payments (razorpay-payments.md §8). Always sent. */
  'subscription_activated',
  'payment_renewal_upcoming',
  'payment_renewed',
  'subscription_renewal_failed',
  'subscription_expiring',
  'subscription_expired',
  'payment_failed',
  'payment_refunded',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new mongoose.Schema(
  {
    recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Null for anonymous types (Secret Messages received, Nearby). */
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    text: { type: String, required: true, maxlength: 300 },
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    reel_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', default: null },
    comment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    /** Public UUID of the Secret Message thread the notification opens. */
    secret_thread_id: { type: String, default: null },
    /** Public UUID of the Secret Crush match the notification opens. */
    crush_match_id: { type: String, default: null },
    conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    /** Hidden until then, so arrival time can't be matched to the sender's activity. */
    deliver_at: { type: Date, default: null },
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
