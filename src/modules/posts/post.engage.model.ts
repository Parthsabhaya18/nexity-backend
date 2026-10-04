import mongoose from 'mongoose';

const likeSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  },
  { collection: 'post_likes', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
likeSchema.index({ user_id: 1, post_id: 1 }, { unique: true });
likeSchema.index({ post_id: 1, _id: -1 });

const saveSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  },
  { collection: 'post_saves', timestamps: { createdAt: 'created_at', updatedAt: false } as const },
);
saveSchema.index({ user_id: 1, post_id: 1 }, { unique: true });
saveSchema.index({ user_id: 1, _id: -1 });

export const COMMENT_MAX = 1000;

const commentSchema = new mongoose.Schema(
  {
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    reel_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', default: null },
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    parent_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    body: { type: String, required: true, maxlength: COMMENT_MAX },
  },
  {
    collection: 'comments',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);
commentSchema.index({ post_id: 1, _id: -1 });
commentSchema.index({ reel_id: 1, _id: -1 });

export const PostLike = mongoose.model('PostLike', likeSchema);
export const PostSave = mongoose.model('PostSave', saveSchema);
export const Comment = mongoose.model('Comment', commentSchema);
