import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

import { VISUAL_KINDS } from '../media/media.rules';

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

const storySchema = new mongoose.Schema(
  {
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    media_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true },
    key: { type: String, required: true },
    kind: { type: String, enum: VISUAL_KINDS, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration_ms: { type: Number, default: null },
    location_name: { type: String, default: '', maxlength: 100 },
    location_lat: { type: Number, default: null },
    location_lng: { type: Number, default: null },
    /** Text, stickers, drawing and interactive stickers. Coordinates are 0–1. */
    overlays: { type: [mongoose.Schema.Types.Mixed], default: [] },
    expires_at: { type: Date, required: true },
  },
  {
    collection: 'stories',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

storySchema.index({ author_id: 1, expires_at: 1 });
storySchema.index({ expires_at: 1 });

const viewSchema = new mongoose.Schema(
  {
    story_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    viewer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'story_views', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
viewSchema.index({ story_id: 1, viewer_id: 1 }, { unique: true });

const pollVoteSchema = new mongoose.Schema(
  {
    story_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    overlay_id: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    option: { type: Number, required: true, min: 0, max: 3 },
  },
  { collection: 'story_poll_votes', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
pollVoteSchema.index({ story_id: 1, overlay_id: 1, user_id: 1 }, { unique: true });

const questionReplySchema = new mongoose.Schema(
  {
    story_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    overlay_id: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 80 },
  },
  { collection: 'story_question_replies', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
questionReplySchema.index({ story_id: 1, overlay_id: 1, user_id: 1 }, { unique: true });

export type StoryDoc = HydratedDocument<InferSchemaType<typeof storySchema>>;
export const Story = mongoose.model('Story', storySchema);
export const StoryView = mongoose.model('StoryView', viewSchema);
export const StoryPollVote = mongoose.model('StoryPollVote', pollVoteSchema);
export const StoryQuestionReply = mongoose.model('StoryQuestionReply', questionReplySchema);

const likeSchema = new mongoose.Schema(
  {
    story_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'story_likes', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
likeSchema.index({ story_id: 1, user_id: 1 }, { unique: true });

const messageSchema = new mongoose.Schema(
  {
    story_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 500 },
  },
  { collection: 'story_messages', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
messageSchema.index({ story_id: 1, _id: -1 });

export const StoryLike = mongoose.model('StoryLike', likeSchema);
export const StoryMessage = mongoose.model('StoryMessage', messageSchema);
