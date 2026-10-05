import { type Types } from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { canViewContent, findVisibleUser } from '../follows/follow.service';
import { Follow } from '../follows/follow.model';
import { notifyComment } from '../notifications/notification.service';
import { audienceIds, isBlockedEither } from '../safety/block.service';
import { avatarUrlOf, User, type UserDoc } from '../users/user.model';
import { extractMentions, MAX_MENTIONS } from './caption';
import { Comment, PostLike, PostSave } from './post.engage.model';
import { Post, type PostDoc } from './post.model';
import { Reel } from '../reels/reel.model';
import { toPostDto } from './post.service';

const pageOf = (limit: number) => Math.min(50, Math.max(1, limit || 20));

async function flagsFor(viewer: UserDoc, ids: Types.ObjectId[]) {
  const [likes, saves] = await Promise.all([
    PostLike.find({ user_id: viewer._id, post_id: { $in: ids } })
      .select('post_id')
      .lean(),
    PostSave.find({ user_id: viewer._id, post_id: { $in: ids } })
      .select('post_id')
      .lean(),
  ]);
  return {
    liked: new Set(likes.map((r) => r.post_id.toHexString())),
    saved: new Set(saves.map((r) => r.post_id.toHexString())),
  };
}

export async function presentPosts(viewer: UserDoc, posts: PostDoc[]) {
  const authors = await User.find({ _id: { $in: posts.map((p) => p.author_id) } });
  const byId = new Map(authors.map((u) => [u.id as string, u]));
  const flags = await flagsFor(
    viewer,
    posts.map((p) => p._id),
  );
  return Promise.all(
    posts.flatMap((post) => {
      const author = byId.get(post.author_id.toHexString());
      if (!author || author.status !== 'active') return [];
      return [
        toPostDto(viewer, post, author, {
          liked: flags.liked.has(post.id as string),
          saved: flags.saved.has(post.id as string),
        }),
      ];
    }),
  );
}

async function visiblePost(viewer: UserDoc, postId: string) {
  const post = await Post.findById(postId);
  if (!post || post.deleted_at) throw ApiError.notFound('This post is no longer available.');
  const author = await findVisibleUser(post.author_id.toHexString()).catch(() => {
    throw ApiError.notFound('This post is no longer available.');
  });
  if (await isBlockedEither(viewer._id, author._id)) {
    throw ApiError.notFound('This post is no longer available.');
  }
  if (!(await canViewContent(viewer, author))) {
    throw ApiError.forbidden(
      'This account is private. Follow them to see their posts.',
      'PRIVATE_ACCOUNT',
    );
  }
  return { post, author };
}

/** Posts from the viewer and the accounts they follow, newest first. */
export async function feed(viewer: UserDoc, cursor: string | undefined, limit: number) {
  const take = pageOf(limit);
  const follows = await Follow.find({ follower_id: viewer._id, status: 'accepted' })
    .select('following_id')
    .lean();
  const filter: Record<string, unknown> = {
    author_id: { $in: await audienceIds(viewer._id, follows.map((f) => f.following_id)) },
    deleted_at: null,
  };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Post.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1);
  const page = rows.slice(0, take);
  return {
    items: await presentPosts(viewer, page),
    next_cursor: rows.length > take ? (page[page.length - 1]!.id as string) : null,
  };
}

export async function postsByUser(
  viewer: UserDoc,
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  const author = await findVisibleUser(userId);
  if (await isBlockedEither(viewer._id, author._id)) throw ApiError.notFound('User not found');
  if (!(await canViewContent(viewer, author))) {
    throw ApiError.forbidden(
      'This account is private. Follow them to see their posts.',
      'PRIVATE_ACCOUNT',
    );
  }
  const take = pageOf(limit);
  const filter: Record<string, unknown> = { author_id: author._id, deleted_at: null };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Post.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1);
  const page = rows.slice(0, take);
  return {
    items: await presentPosts(viewer, page),
    next_cursor: rows.length > take ? (page[page.length - 1]!.id as string) : null,
  };
}

export async function savedPosts(viewer: UserDoc, cursor: string | undefined, limit: number) {
  const take = pageOf(limit);
  const filter: Record<string, unknown> = { user_id: viewer._id };
  if (cursor) filter._id = { $lt: cursor };
  const saves = await PostSave.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1)
    .lean();
  const page = saves.slice(0, take);
  const posts = await Post.find({
    _id: { $in: page.map((s) => s.post_id) },
    deleted_at: null,
  });
  const byId = new Map(posts.map((p) => [p.id as string, p]));
  const ordered = page.flatMap((s) => {
    const post = byId.get(s.post_id.toHexString());
    return post ? [post] : [];
  });
  return {
    items: await presentPosts(viewer, ordered),
    next_cursor: saves.length > take ? page[page.length - 1]!._id.toHexString() : null,
  };
}

async function counted(
  viewer: UserDoc,
  post: PostDoc,
  author: UserDoc,
  field: 'likes_count' | 'comments_count',
  delta: 1 | -1,
) {
  const guard = delta < 0 ? { [field]: { $gt: 0 } } : {};
  await Post.updateOne({ _id: post._id, ...guard }, { $inc: { [field]: delta } });
  const fresh = (await Post.findById(post._id)) ?? post;
  const flags = await flagsFor(viewer, [fresh._id]);
  return toPostDto(viewer, fresh, author, {
    liked: flags.liked.has(fresh.id as string),
    saved: flags.saved.has(fresh.id as string),
  });
}

/** Sets the like on or off. Repeating the same request changes nothing. */
export async function setLike(viewer: UserDoc, postId: string, want: boolean) {
  const { post, author } = await visiblePost(viewer, postId);
  let delta: 1 | -1 | 0 = 0;
  if (want) {
    const res = await PostLike.updateOne(
      { user_id: viewer._id, post_id: post._id },
      { $setOnInsert: { user_id: viewer._id, post_id: post._id } },
      { upsert: true },
    );
    if (res.upsertedCount > 0) delta = 1;
  } else {
    const res = await PostLike.deleteOne({ user_id: viewer._id, post_id: post._id });
    if (res.deletedCount > 0) delta = -1;
  }
  let dto;
  if (delta === 0) {
    const flags = await flagsFor(viewer, [post._id]);
    dto = await toPostDto(viewer, post, author, {
      liked: flags.liked.has(post.id as string),
      saved: flags.saved.has(post.id as string),
    });
  } else {
    dto = await counted(viewer, post, author, 'likes_count', delta);
  }
  return { liked: dto.liked_by_me, likes_count: dto.likes_count, post: dto };
}

export async function toggleLike(viewer: UserDoc, postId: string) {
  const liked = await PostLike.exists({ user_id: viewer._id, post_id: postId });
  return setLike(viewer, postId, !liked);
}
export async function toggleSave(viewer: UserDoc, postId: string) {
  const { post, author } = await visiblePost(viewer, postId);
  const existing = await PostSave.findOneAndDelete({ user_id: viewer._id, post_id: post._id });
  if (!existing) await PostSave.create({ user_id: viewer._id, post_id: post._id });
  const flags = await flagsFor(viewer, [post._id]);
  return {
    saved: !existing,
    post: await toPostDto(viewer, post, author, {
      liked: flags.liked.has(post.id as string),
      saved: !existing,
    }),
  };
}

export async function listComments(
  viewer: UserDoc,
  postId: string,
  cursor: string | undefined,
  limit: number,
) {
  await visiblePost(viewer, postId);
  const take = pageOf(limit);
  const filter: Record<string, unknown> = { post_id: postId, parent_id: null };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Comment.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1);
  const page = rows.slice(0, take);
  const replies = await Comment.find({ parent_id: { $in: page.map((c) => c._id) } }).sort({
    _id: 1,
  });
  const authors = await User.find({
    _id: { $in: [...page, ...replies].map((c) => c.author_id) },
  });
  const byId = new Map(authors.map((u) => [u.id as string, u]));
  const replyOf = (parent: Types.ObjectId) =>
    replies.filter((r) => r.parent_id?.equals(parent));
  return {
    items: await Promise.all(page.map((c) => commentDto(c, byId, replyOf(c._id)))),
    next_cursor: rows.length > take ? (page[page.length - 1]!.id as string) : null,
  };
}

export type CommentShape = {
  id: string;
  body: string;
  author: { id: string; username: string; display_name: string; avatar_url: string | null } | null;
  created_at: string;
  replies: CommentShape[];
};

export async function commentDto(
  comment: { id: string; author_id: Types.ObjectId; body: string; get: (k: string) => unknown },
  users: Map<string, UserDoc>,
  replies: { id: string; author_id: Types.ObjectId; body: string; get: (k: string) => unknown }[] = [],
): Promise<CommentShape> {
  const author = users.get(comment.author_id.toHexString());
  return {
    id: comment.id,
    body: comment.body,
    author: author
      ? {
          id: author.id as string,
          username: author.username,
          display_name: author.display_name,
          avatar_url: await avatarUrlOf(author),
        }
      : null,
    created_at: (comment.get('created_at') as Date).toISOString(),
    replies: await Promise.all(replies.map((r) => commentDto(r, users))),
  };
}

export async function addComment(
  viewer: UserDoc,
  postId: string,
  body: string,
  parentId?: string,
) {
  const { post } = await visiblePost(viewer, postId);
  if (post.comments_disabled) {
    throw ApiError.forbidden('Comments are turned off for this post.', 'COMMENTS_DISABLED');
  }
  const parent = parentId
    ? await Comment.findOne({ _id: parentId, post_id: post._id, parent_id: null })
    : null;
  if (parentId && !parent) throw ApiError.notFound('That comment is no longer available.');
  const comment = await Comment.create({
    post_id: post._id,
    author_id: viewer._id,
    parent_id: parentId ?? null,
    body,
  });
  if (!parentId) await Post.updateOne({ _id: post._id }, { $inc: { comments_count: 1 } });
  await notifyComment({
    actor: viewer,
    recipientId: post.author_id,
    kind: 'post',
    body,
    postId: post._id,
    commentId: comment._id,
  });
  if (parent && !parent.author_id.equals(post.author_id)) {
      await notifyComment({
        actor: viewer,
        recipientId: parent.author_id,
        kind: 'post',
        body,
        postId: post._id,
        commentId: comment._id,
        reply: true,
      });
  }
  const users = new Map([[viewer.id as string, viewer]]);
  return await commentDto(comment, users);
}

export async function deleteComment(viewer: UserDoc, commentId: string) {
  const comment = await Comment.findById(commentId);
  const gone = () => ApiError.notFound('That comment is no longer available.');
  if (!comment) throw gone();
  if (comment.post_id) {
    const post = await Post.findById(comment.post_id);
    if (!post || post.deleted_at) throw gone();
    const owner = post.author_id.equals(viewer._id) || comment.author_id.equals(viewer._id);
    if (!owner) throw ApiError.forbidden('You can only delete your own comments.');
    await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent_id: comment._id }] });
    if (!comment.parent_id) {
      await Post.updateOne(
        { _id: post._id, comments_count: { $gt: 0 } },
        { $inc: { comments_count: -1 } },
      );
    }
    return;
  }
  if (comment.reel_id) {
    const reel = await Reel.findById(comment.reel_id);
    if (!reel || reel.deleted_at) throw gone();
    const owner = reel.author_id.equals(viewer._id) || comment.author_id.equals(viewer._id);
    if (!owner) throw ApiError.forbidden('You can only delete your own comments.');
    await Comment.deleteOne({ _id: comment._id });
    await Reel.updateOne(
      { _id: reel._id, comments_count: { $gt: 0 } },
      { $inc: { comments_count: -1 } },
    );
    return;
  }
  throw gone();
}
export async function deletePost(viewer: UserDoc, postId: string) {
  const post = await Post.findOne({ _id: postId, author_id: viewer._id, deleted_at: null });
  if (!post) throw ApiError.notFound('This post is no longer available.');
  post.deleted_at = new Date();
  await post.save();
  await User.updateOne(
    { _id: viewer._id, posts_count: { $gt: 0 } },
    { $inc: { posts_count: -1 } },
  );
}

export async function updatePost(
  viewer: UserDoc,
  postId: string,
  input: {
    caption?: string;
    location_name?: string;
    alt_texts?: string[];
    hide_like_count?: boolean;
    comments_disabled?: boolean;
  },
) {
  const post = await Post.findOne({ _id: postId, author_id: viewer._id, deleted_at: null });
  if (!post) throw ApiError.notFound('This post is no longer available.');
  if (input.caption !== undefined) {
    const names = extractMentions(input.caption).filter((n) => n !== viewer.username);
    if (names.length > MAX_MENTIONS) {
      throw ApiError.badRequest(`You can mention up to ${MAX_MENTIONS} people.`, undefined, 'TOO_MANY_MENTIONS');
    }
    const found = names.length
      ? await User.find({ username: { $in: names }, status: 'active', is_verified: true })
          .select('_id username')
          .lean()
      : [];
    post.caption = input.caption;
    post.mentions = found.map((u) => u.username);
    post.mention_ids = found.map((u) => u._id);
  }
  if (input.location_name !== undefined) post.location_name = input.location_name;
  if (input.hide_like_count !== undefined) post.hide_like_count = input.hide_like_count;
  if (input.comments_disabled !== undefined) post.comments_disabled = input.comments_disabled;
  if (input.alt_texts) {
    post.media.forEach((m, i) => {
      if (input.alt_texts![i] !== undefined) m.alt_text = input.alt_texts![i]!;
    });
    post.markModified('media');
  }
  await post.save();
  const flags = await flagsFor(viewer, [post._id]);
  return toPostDto(viewer, post, viewer, {
    liked: flags.liked.has(post.id as string),
    saved: flags.saved.has(post.id as string),
  });
}

export async function listLikers(viewer: UserDoc, postId: string, cursor: string | undefined, limit: number) {
  const { post } = await visiblePost(viewer, postId);
  if (post.hide_like_count && !post.author_id.equals(viewer._id)) {
    throw ApiError.forbidden('The like count is hidden on this post.', 'LIKES_HIDDEN');
  }
  const take = pageOf(limit);
  const filter: Record<string, unknown> = { post_id: post._id };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await PostLike.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1)
    .lean();
  const page = rows.slice(0, take);
  const users = await User.find({ _id: { $in: page.map((r) => r.user_id) }, status: 'active' });
  const byId = new Map(users.map((u) => [u.id as string, u]));
  return {
    items: page.flatMap((r) => {
      const u = byId.get(r.user_id.toHexString());
      return u ? [{ id: u.id as string, username: u.username, display_name: u.display_name }] : [];
    }),
    next_cursor: rows.length > take ? page[page.length - 1]!._id.toHexString() : null,
  };
}
