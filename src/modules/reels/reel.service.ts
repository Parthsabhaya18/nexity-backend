import { createHash, randomBytes } from 'node:crypto';

import mongoose from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { FEED_CURSOR } from '../posts/post.schema';
import { canViewContent, findVisibleUser, toUserSummaries } from '../follows/follow.service';
import { notifyComment } from '../notifications/notification.service';
import { audienceIds, isBlockedEither } from '../safety/block.service';
import { Follow } from '../follows/follow.model';
import { Media } from '../media/media.model';
import { viewUrl } from '../media/media.storage';
import { User, type UserDoc } from '../users/user.model';
import { extractMentions, MAX_MENTIONS } from '../posts/caption';
import { Comment } from '../posts/post.engage.model';
import { commentDto } from '../posts/post.extra';
import { Reel, ReelLike, type ReelDoc } from './reel.model';

const MONGO_DUPLICATE_KEY = 11000;
const pageOf = (limit: number) => Math.min(50, Math.max(1, limit || 20));

async function toReelDto(viewer: UserDoc, reel: ReelDoc, author: UserDoc, liked: boolean) {
  const [summary] = await toUserSummaries(viewer, [author]);
  return {
    id: reel.id as string,
    author: summary!,
    video_url: await viewUrl(reel.video_key),
    width: reel.width,
    height: reel.height,
    duration_ms: reel.duration_ms,
    caption: reel.caption,
    mentions: reel.mentions,
    location_name: reel.location_name,
    location_lat: reel.location_lat ?? null,
    location_lng: reel.location_lng ?? null,
    audio_muted: reel.audio_muted ?? false,
    cover_time_ms: reel.cover_time_ms ?? 0,
    cover_url: reel.cover_key ? await viewUrl(reel.cover_key) : null,
    trim_start_ms: reel.trim_start_ms,
    trim_end_ms: reel.trim_end_ms,
    /** Hidden from everyone, the owner included, while `hide_like_count` is on. */
    likes_count: reel.hide_like_count ? null : reel.likes_count,
    comments_count: reel.comments_count,
    hide_like_count: reel.hide_like_count ?? false,
    comments_disabled: reel.comments_disabled ?? false,
    liked_by_me: liked,
    is_owner: author._id.equals(viewer._id),
    created_at: (reel.get('created_at') as Date).toISOString(),
  };
}

async function present(viewer: UserDoc, reels: ReelDoc[]) {
  const authors = await User.find({ _id: { $in: reels.map((r) => r.author_id) } });
  const byId = new Map(authors.map((u) => [u.id as string, u]));
  const likes = await ReelLike.find({
    user_id: viewer._id,
    reel_id: { $in: reels.map((r) => r._id) },
  })
    .select('reel_id')
    .lean();
  const liked = new Set(likes.map((l) => l.reel_id.toHexString()));
  return Promise.all(
    reels.flatMap((reel) => {
      const author = byId.get(reel.author_id.toHexString());
      if (!author || author.status !== 'active') return [];
      return [toReelDto(viewer, reel, author, liked.has(reel.id as string))];
    }),
  );
}

async function resolveMentions(author: UserDoc, caption: string) {
  const names = extractMentions(caption)
    .filter((n) => n !== author.username)
    .slice(0, MAX_MENTIONS);
  if (!names.length) return [];
  return User.find({ username: { $in: names }, status: 'active', is_verified: true })
    .select('_id username')
    .lean();
}

export async function createReel(
  author: UserDoc,
  input: {
    video_media_id: string;
    caption: string;
    location_name: string;
    location_lat?: number | null;
    location_lng?: number | null;
    audio_muted?: boolean;
    hide_like_count?: boolean;
    comments_disabled?: boolean;
    cover_time_ms?: number;
    cover_media_id?: string;
    client_upload_id?: string;
    trim_start_ms?: number | null;
    trim_end_ms?: number | null;
  },
) {
  if (input.client_upload_id) {
    const existing = await Reel.findOne({
      author_id: author._id,
      client_upload_id: input.client_upload_id,
    });
    if (existing) return { reel: await toReelDto(author, existing, author, false), created: false };
  }
  const mentions = await resolveMentions(author, input.caption);
  if (
    input.trim_start_ms != null &&
    input.trim_end_ms != null &&
    input.trim_end_ms - input.trim_start_ms < 1000
  ) {
    throw ApiError.badRequest('A reel clip has to be at least 1 second.', undefined, 'TRIM_TOO_SHORT');
  }
  let coverKey: string | null = null;
  if (input.cover_media_id) {
    const cover = await Media.findOne({ _id: input.cover_media_id, owner_id: author._id });
    if (!cover || cover.status !== 'ready' || cover.kind !== 'image' || (cover.purpose !== 'post' && cover.purpose !== 'reel')) {
      throw ApiError.badRequest('That cover photo did not finish uploading.', { field: 'cover_media_id' }, 'INVALID_MEDIA');
    }
    coverKey = cover.key;
  }
  const media = await Media.findOne({ _id: input.video_media_id, owner_id: author._id });
  if (!media || media.status !== 'ready' || media.purpose !== 'reel' || media.kind !== 'video') {
    throw ApiError.badRequest(
      "That video didn't finish uploading. Please try again.",
      { field: 'video_media_id' },
      'INVALID_MEDIA',
    );
  }
  let reel: ReelDoc;
  try {
    reel = await Reel.create({
      author_id: author._id,
      video_media_id: media._id,
      video_key: media.key,
      width: media.width,
      height: media.height,
      duration_ms: media.duration_ms,
      caption: input.caption,
      mention_ids: mentions.map((u) => u._id),
      mentions: mentions.map((u) => u.username),
      location_name: input.location_name,
      location_lat: input.location_lat ?? null,
      location_lng: input.location_lng ?? null,
      audio_muted: input.audio_muted ?? false,
      hide_like_count: input.hide_like_count ?? false,
      comments_disabled: input.comments_disabled ?? false,
      cover_time_ms: input.cover_time_ms ?? 0,
      cover_key: coverKey,
      trim_start_ms: input.trim_start_ms ?? null,
      trim_end_ms: input.trim_end_ms ?? null,
      client_upload_id: input.client_upload_id ?? null,
    });
  } catch (err) {
    if (err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY && input.client_upload_id) {
      const raced = await Reel.findOne({ author_id: author._id, client_upload_id: input.client_upload_id });
      if (raced) return { reel: await toReelDto(author, raced, author, false), created: false };
    }
    throw err;
  }
  return { reel: await toReelDto(author, reel, author, false), created: true };
}

/** How many of the newest eligible reels the feed shuffles. */
const FEED_POOL = 500;

const shuffleKey = (seed: string, id: string) =>
  createHash('sha1').update(seed + id).digest('hex').slice(0, 16);

/**
 * Reels in random order, like the home feed. Each reel gets a stable key from
 * the seed, so paging never repeats one; a fresh load picks a new order.
 */
export async function reelFeed(viewer: UserDoc, cursor: string | undefined, limit: number) {
  const take = pageOf(limit);
  const match = cursor ? FEED_CURSOR.exec(cursor) : null;
  const seed = match?.[1] ?? randomBytes(4).toString('hex');
  const after = match?.[2] ?? '';
  const follows = await Follow.find({ follower_id: viewer._id, status: 'accepted' })
    .select('following_id')
    .lean();
  const pool = await Reel.find({
    author_id: { $in: await audienceIds(viewer._id, follows.map((f) => f.following_id)) },
    deleted_at: null,
  })
    .sort({ _id: -1 })
    .limit(FEED_POOL)
    .select('_id')
    .lean();
  const ordered = pool
    .map((r) => ({ id: r._id, key: shuffleKey(seed, r._id.toHexString()) }))
    .filter((r) => r.key > after)
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const page = ordered.slice(0, take);

  const docs = await Reel.find({ _id: { $in: page.map((r) => r.id) } });
  const byId = new Map(docs.map((d) => [d.id as string, d]));
  const reels = page.flatMap((r) => byId.get(r.id.toHexString()) ?? []);
  return {
    items: await present(viewer, reels),
    next_cursor: ordered.length > take ? `${seed}_${page[page.length - 1]!.key}` : null,
  };
}

export async function reelsByUser(viewer: UserDoc, userId: string, cursor: string | undefined, limit: number) {
  const author = await findVisibleUser(userId);
  if (await isBlockedEither(viewer._id, author._id)) throw ApiError.notFound('User not found');
  if (!(await canViewContent(viewer, author))) {
    throw ApiError.forbidden('This account is private. Follow them to see their reels.', 'PRIVATE_ACCOUNT');
  }
  const take = pageOf(limit);
  const filter: Record<string, unknown> = { author_id: author._id, deleted_at: null };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Reel.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1);
  const page = rows.slice(0, take);
  return {
    items: await present(viewer, page),
    next_cursor: rows.length > take ? (page[page.length - 1]!.id as string) : null,
  };
}

async function visibleReel(viewer: UserDoc, reelId: string) {
  const reel = await Reel.findById(reelId);
  if (!reel || reel.deleted_at) throw ApiError.notFound('This reel is no longer available.');
  const author = await findVisibleUser(reel.author_id.toHexString());
  if (await isBlockedEither(viewer._id, author._id)) {
    throw ApiError.notFound('This reel is no longer available.');
  }
  if (!(await canViewContent(viewer, author))) {
    throw ApiError.forbidden('This account is private.', 'PRIVATE_ACCOUNT');
  }
  return { reel, author };
}

export async function getReel(viewer: UserDoc, reelId: string) {
  const { reel, author } = await visibleReel(viewer, reelId);
  const liked = await ReelLike.exists({ user_id: viewer._id, reel_id: reel._id });
  return toReelDto(viewer, reel, author, !!liked);
}

/** Sets the like on or off. Repeating the same request changes nothing. */
export async function setReelLike(viewer: UserDoc, reelId: string, want: boolean) {
  const { reel, author } = await visibleReel(viewer, reelId);
  let delta = 0;
  if (want) {
    const res = await ReelLike.updateOne(
      { user_id: viewer._id, reel_id: reel._id },
      { $setOnInsert: { user_id: viewer._id, reel_id: reel._id } },
      { upsert: true },
    );
    if (res.upsertedCount > 0) delta = 1;
  } else {
    const res = await ReelLike.deleteOne({ user_id: viewer._id, reel_id: reel._id });
    if (res.deletedCount > 0) delta = -1;
  }
  if (delta !== 0) {
    await Reel.updateOne(
      { _id: reel._id, ...(delta < 0 ? { likes_count: { $gt: 0 } } : {}) },
      { $inc: { likes_count: delta } },
    );
  }
  const fresh = (await Reel.findById(reel._id)) ?? reel;
  return toReelDto(viewer, fresh, author, want);
}

export async function toggleReelLike(viewer: UserDoc, reelId: string) {
  const liked = await ReelLike.exists({ user_id: viewer._id, reel_id: reelId });
  return setReelLike(viewer, reelId, !liked);
}

export async function updateReel(
  viewer: UserDoc,
  reelId: string,
  input: { caption?: string; hide_like_count?: boolean; comments_disabled?: boolean },
) {
  const reel = await Reel.findOne({ _id: reelId, author_id: viewer._id, deleted_at: null });
  if (!reel) throw ApiError.notFound('This reel is no longer available.');
  if (input.caption !== undefined) {
    const mentions = await resolveMentions(viewer, input.caption);
    reel.caption = input.caption;
    reel.mentions = mentions.map((u) => u.username);
    reel.mention_ids = mentions.map((u) => u._id);
  }
  if (input.hide_like_count !== undefined) reel.hide_like_count = input.hide_like_count;
  if (input.comments_disabled !== undefined) reel.comments_disabled = input.comments_disabled;
  await reel.save();
  const liked = await ReelLike.exists({ user_id: viewer._id, reel_id: reel._id });
  return toReelDto(viewer, reel, viewer, !!liked);
}

export async function deleteReel(viewer: UserDoc, reelId: string) {
  const reel = await Reel.findOne({ _id: reelId, author_id: viewer._id, deleted_at: null });
  if (!reel) throw ApiError.notFound('This reel is no longer available.');
  reel.deleted_at = new Date();
  await reel.save();
}

export async function addReelComment(viewer: UserDoc, reelId: string, body: string) {
  const { reel } = await visibleReel(viewer, reelId);
  if (reel.comments_disabled) {
    throw ApiError.forbidden('Comments are turned off for this reel.', 'COMMENTS_DISABLED');
  }
  const comment = await Comment.create({ reel_id: reel._id, author_id: viewer._id, body });
  await Reel.updateOne({ _id: reel._id }, { $inc: { comments_count: 1 } });
  await notifyComment({
    actor: viewer,
    recipientId: reel.author_id,
    kind: 'reel',
    body,
    reelId: reel._id,
    commentId: comment._id,
  });
  return commentDto(comment, new Map([[viewer.id as string, viewer]]));
}

export async function listReelComments(viewer: UserDoc, reelId: string, cursor: string | undefined, limit: number) {
  await visibleReel(viewer, reelId);
  const take = pageOf(limit);
  const filter: Record<string, unknown> = { reel_id: reelId };
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Comment.find(filter)
    .sort({ _id: -1 })
    .limit(take + 1);
  const page = rows.slice(0, take);
  const users = await User.find({ _id: { $in: page.map((c) => c.author_id) } });
  const byId = new Map(users.map((u) => [u.id as string, u]));
  return {
    items: await Promise.all(page.map((c) => commentDto(c, byId))),
    next_cursor: rows.length > take ? (page[page.length - 1]!.id as string) : null,
  };
}
