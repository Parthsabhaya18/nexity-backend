import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

import { MEDIA_KINDS } from '../media/media.rules';
import { CAPTION_MAX } from './caption';

export const ALT_TEXT_MAX = 100;
export const LOCATION_MAX = 100;
export const MUSIC_MAX = 80;
/** Instagram crops feed media between 4:5 portrait and 1.91:1 landscape. */
export const MIN_ASPECT = 0.8;
export const MAX_ASPECT = 1.91;

const postMediaSchema = new mongoose.Schema(
  {
    media_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true },
    key: { type: String, required: true },
    kind: { type: String, enum: MEDIA_KINDS, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    alt_text: { type: String, default: '', maxlength: ALT_TEXT_MAX },
    duration_ms: { type: Number, default: null },
    /** Named colour look for this photo. `normal` leaves it unchanged. */
    filter: { type: String, default: 'normal' },
  },
  { _id: false },
);

const postSchema = new mongoose.Schema(
  {
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Carousel order. */
    media: { type: [postMediaSchema], required: true },
    caption: { type: String, default: '', maxlength: CAPTION_MAX },
    /** Lowercase, without `#`. */
    hashtags: { type: [String], default: [] },
    /** Mentioned accounts that existed when the post was shared. */
    mention_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    mentions: { type: [String], default: [] },
    location_name: { type: String, default: '', maxlength: LOCATION_MAX },
    location_lat: { type: Number, default: null },
    location_lng: { type: Number, default: null },
    /** Photo look replayed in the feed. Each value is -100..100 or 0..100. */
    adjustments: {
      brightness: { type: Number, default: 0 },
      contrast: { type: Number, default: 0 },
      saturation: { type: Number, default: 0 },
      warmth: { type: Number, default: 0 },
      fade: { type: Number, default: 0 },
      sharpen: { type: Number, default: 0 },
      blur: { type: Number, default: 0 },
      vignette: { type: Number, default: 0 },
    },
    /** Song name shown on the post. Playback uses the viewer's own library. */
    music_title: { type: String, default: '', maxlength: MUSIC_MAX },
    /** Width / height of the frame every carousel item is shown in. */
    aspect_ratio: { type: Number, default: 1, min: MIN_ASPECT, max: MAX_ASPECT },
    hide_like_count: { type: Boolean, default: false },
    comments_disabled: { type: Boolean, default: false },
    likes_count: { type: Number, default: 0, min: 0 },
    comments_count: { type: Number, default: 0, min: 0 },
    /** Sent by the app so a retried share returns the same post. */
    client_upload_id: { type: String, default: null },
    /** Set when the owner deletes the post; lists skip these. */
    deleted_at: { type: Date, default: null },
  },
  {
    collection: 'posts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

postSchema.index({ author_id: 1, _id: -1 });
postSchema.index(
  { author_id: 1, client_upload_id: 1 },
  { unique: true, partialFilterExpression: { client_upload_id: { $type: 'string' } } },
);
postSchema.index({ 'media.media_id': 1 });
postSchema.index({ hashtags: 1, _id: -1 });
postSchema.index({ location_name: 1 });

export type PostAttrs = InferSchemaType<typeof postSchema>;
export type PostDoc = HydratedDocument<PostAttrs>;

export const Post = mongoose.model('Post', postSchema);

const hashtagSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    post_count: { type: Number, default: 0, min: 0 },
  },
  {
    collection: 'hashtags',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

hashtagSchema.index({ post_count: -1 });

export const Hashtag = mongoose.model('Hashtag', hashtagSchema);
