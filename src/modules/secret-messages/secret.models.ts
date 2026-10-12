import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const SECRET_THREAD_STATUSES = ['sealed', 'revealed', 'archived', 'withdrawn'] as const;

/** Ids are random UUIDs (`public_id`): ObjectIds would leak the exact creation second. */
const secretThreadSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true },
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: SECRET_THREAD_STATUSES, default: 'sealed' },
    /** Receiver replies so far; the 2nd one reveals. */
    replies_used: { type: Number, default: 0, min: 0, max: 2 },
    /** Sender messages after the first one without a receiver reply in between (max 3). */
    sender_followups_unanswered: { type: Number, default: 0, min: 0 },
    conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    revealed_at: { type: Date, default: null },
    last_activity_at: { type: Date, required: true },
    last_sender_message_at: { type: Date, default: null },
    last_recipient_message_at: { type: Date, default: null },
    sender_last_read_at: { type: Date, default: null },
    recipient_last_read_at: { type: Date, default: null },
    sender_hidden: { type: Boolean, default: false },
    recipient_hidden: { type: Boolean, default: false },
    /** Last time a follow-up notice went to the receiver (max one per hour). */
    followup_notified_at: { type: Date, default: null },
  },
  {
    collection: 'secret_threads',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

secretThreadSchema.index({ public_id: 1 }, { unique: true });
// One open sealed thread per sender → recipient.
secretThreadSchema.index(
  { sender_id: 1, recipient_id: 1 },
  { unique: true, partialFilterExpression: { status: 'sealed' } },
);
secretThreadSchema.index({ recipient_id: 1, last_activity_at: -1 });
secretThreadSchema.index({ sender_id: 1, last_activity_at: -1 });

export type SecretThreadAttrs = InferSchemaType<typeof secretThreadSchema> & {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
};
export const SecretThread = mongoose.model('SecretThread', secretThreadSchema);

const secretMessageSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true },
    thread_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SecretThread', required: true },
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    from: { type: String, enum: ['sender', 'recipient'], required: true },
    /** AES-256-GCM, `iv.tag.ciphertext` in base64. */
    body_enc: { type: String, required: true },
    client_message_id: { type: String, required: true },
  },
  {
    collection: 'secret_thread_messages',
    timestamps: { createdAt: 'created_at', updatedAt: false } as const,
  },
);

secretMessageSchema.index({ public_id: 1 }, { unique: true });
secretMessageSchema.index({ thread_id: 1, _id: 1 });
secretMessageSchema.index({ author_id: 1, client_message_id: 1 }, { unique: true });

export type SecretMessageAttrs = InferSchemaType<typeof secretMessageSchema> & {
  _id: Types.ObjectId;
  created_at: Date;
};
export const SecretMessage = mongoose.model('SecretMessage', secretMessageSchema);

/** Anonymous block: the blocker never learns who `blocked_id` is. */
const secretBlockSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true },
    blocker_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    blocked_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'secret_blocks',
    timestamps: { createdAt: 'created_at', updatedAt: false } as const,
  },
);

secretBlockSchema.index({ public_id: 1 }, { unique: true });
secretBlockSchema.index({ blocker_id: 1, blocked_id: 1 }, { unique: true });
secretBlockSchema.index({ blocked_id: 1 });

export const SecretBlock = mongoose.model('SecretBlock', secretBlockSchema);
