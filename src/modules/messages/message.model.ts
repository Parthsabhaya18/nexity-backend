import mongoose, { type InferSchemaType, type Types } from 'mongoose';

import { MESSAGE_TYPES } from './conversation.model';

export const MESSAGE_MAX_LENGTH = 2000;
/** Own text messages can be edited for this long after sending (like Instagram). */
export const EDIT_WINDOW_MS = 15 * 60_000;

/**
 * `giphy`: GIF picked in the composer (no upload, URL from GIPHY's CDN).
 * `upload`: photo, video or voice note stored by the media service.
 */
const messageMediaSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['giphy', 'upload'], required: true },
    provider_id: { type: String, default: null },
    media_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    /** S3 key of an upload; `url` is re-signed from it on every read because signed URLs expire. */
    key: { type: String, default: null },
    url: { type: String, required: true },
    preview_url: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration_ms: { type: Number, default: null },
  },
  { _id: false },
);

/** One reaction per user per message; picking another emoji replaces it. */
const reactionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true },
    created_at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: MESSAGE_TYPES, default: 'text' },
    body: { type: String, default: '', trim: true, maxlength: MESSAGE_MAX_LENGTH },
    media: { type: messageMediaSchema, default: null },
    /** Album items, in the order they were picked; `media` stays null for albums. */
    media_items: { type: [messageMediaSchema], default: [] },
    reply_to_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    /** Replying to one photo or video of an album. */
    reply_to_index: { type: Number, default: null },
    /** Generated on the device; makes retries idempotent and matches optimistic bubbles. */
    client_message_id: { type: String, required: true },
    reactions: { type: [reactionSchema], default: [] },
    edited_at: { type: Date, default: null },
    /** Unsend: the row stays for moderation and ordering, the content is hidden. */
    deleted_at: { type: Date, default: null },
  },
  {
    collection: 'messages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

// Thread pagination: ObjectIds are time-ordered, so `_id` doubles as the cursor.
messageSchema.index({ conversation_id: 1, _id: -1 });
messageSchema.index({ sender_id: 1, client_message_id: 1 }, { unique: true });

export type MessageAttrs = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId };

export const Message = mongoose.model('Message', messageSchema);
