import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

import { CAPTION_MAX } from '../posts/caption';
import { LOCATION_MAX, MUSIC_MAX } from '../posts/post.model';

const reelSchema = new mongoose.Schema(
  {
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    video_media_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true },
    video_key: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration_ms: { type: Number, default: null },
    caption: { type: String, default: '', maxlength: CAPTION_MAX },
    hashtags: { type: [String], default: [] },
    mentions: { type: [String], default: [] },
    location_name: { type: String, default: '', maxlength: LOCATION_MAX },
    location_lat: { type: Number, default: null },
    location_lng: { type: Number, default: null },
    /** Colour look drawn over the video. `normal` is unchanged. */
    filter: { type: String, default: 'normal' },
    music_title: { type: String, default: '', maxlength: MUSIC_MAX },
    /** Author muted the clip's original sound for every viewer. */
    audio_muted: { type: Boolean, default: false },
    /** Frame used as the grid cover, in milliseconds. */
    cover_time_ms: { type: Number, default: 0 },
    /** Optional uploaded cover photo. */
    cover_key: { type: String, default: null },
    /** Playback window. Null plays the whole file. */
    trim_start_ms: { type: Number, default: null },
    trim_end_ms: { type: Number, default: null },
    likes_count: { type: Number, default: 0, min: 0 },
    comments_count: { type: Number, default: 0, min: 0 },
    client_upload_id: { type: String, default: null },
    deleted_at: { type: Date, default: null },
  },
  {
    collection: 'reels',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

reelSchema.index({ author_id: 1, _id: -1 });
reelSchema.index(
  { author_id: 1, client_upload_id: 1 },
  { unique: true, partialFilterExpression: { client_upload_id: { $type: 'string' } } },
);

const reelLikeSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reel_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true },
  },
  { collection: 'reel_likes', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
reelLikeSchema.index({ user_id: 1, reel_id: 1 }, { unique: true });

export type ReelDoc = HydratedDocument<InferSchemaType<typeof reelSchema>>;
export const Reel = mongoose.model('Reel', reelSchema);
export const ReelLike = mongoose.model('ReelLike', reelLikeSchema);
