import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const CONVERSATION_TYPES = ['direct', 'group'] as const;
export const MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  /** Several photos / videos sent together, shown as one stack. */
  'album',
  'gif',
  'sticker',
  'voice',
  'system',
  /** A post, reel or profile sent from its share sheet; the bubble shows it as a card. */
  'share_post',
  'share_reel',
  'share_profile',
] as const;

/** Per-participant state. Read receipts and unread counts live here, not on every message. */
const memberSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['member', 'admin'], default: 'member' },
    joined_at: { type: Date, default: () => new Date() },
    last_read_message_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    last_read_at: { type: Date, default: null },
    unread_count: { type: Number, default: 0, min: 0 },
    muted_until: { type: Date, default: null },
    /** "Delete chat" for this member only: hides it until a new message and hides older messages. */
    cleared_at: { type: Date, default: null },
    hidden: { type: Boolean, default: false },
  },
  { _id: false },
);

/** Denormalised preview so the inbox never has to read the messages collection. */
const lastMessageSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    sender_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, enum: MESSAGE_TYPES, required: true },
    body: { type: String, default: '' },
    is_deleted: { type: Boolean, default: false },
    created_at: { type: Date, required: true },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: CONVERSATION_TYPES, required: true },
    /** Sorted participant ids joined with ":" — guarantees one direct conversation per pair. */
    direct_key: { type: String, default: undefined },
    participant_ids: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
    },
    members: { type: [memberSchema], required: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    last_message: { type: lastMessageSchema, default: null },
    last_message_at: { type: Date, default: null },
    message_count: { type: Number, default: 0 },
    /**
     * `secret_message`: opened by a Secret Message reveal ("💌 Revealed" tag).
     * `secret_crush_match`: opened by a mutual Secret Crush ("💘 Match" tag).
     */
    origin: { type: String, enum: ['secret_message', 'secret_crush_match', null], default: null },
    /** Scoped chat theme; `love` for Secret Crush matches. */
    theme: { type: String, enum: ['love', null], default: null },
  },
  {
    collection: 'conversations',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

conversationSchema.index(
  { direct_key: 1 },
  { unique: true, partialFilterExpression: { direct_key: { $type: 'string' } } },
);
// Inbox: my conversations, newest activity first.
conversationSchema.index({ participant_ids: 1, last_message_at: -1, _id: -1 });

export type ConversationAttrs = InferSchemaType<typeof conversationSchema> & {
  _id: Types.ObjectId;
};
export type ConversationMember = InferSchemaType<typeof memberSchema>;

export const Conversation = mongoose.model('Conversation', conversationSchema);

export const directKeyOf = (a: string, b: string) => [a, b].sort().join(':');
