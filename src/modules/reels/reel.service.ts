import mongoose from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { canViewContent, findVisibleUser, toUserSummaries } from '../follows/follow.service';
import { notifyComment } from '../notifications/notification.service';
import { audienceIds, isBlockedEither } from '../safety/block.service';
import { Follow } from '../follows/follow.model';
import { Media } from '../media/media.model';
import { viewUrl } from '../media/media.storage';
import { User, type UserDoc } from '../users/user.model';
import { extractHashtags, extractMentions, MAX_HASHTAGS, MAX_MENTIONS } from '../posts/caption';
import { Comment } from '../posts/post.engage.model';
import { Hashtag } from '../posts/post.model';
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
    hashtags: reel.hashtags,
    mentions: reel.mentions,
    location_name: reel.location_name,
    location_lat: reel.location_lat ?? null,
    location_lng: reel.location_lng ?? null,
    filter: reel.filter || 'normal',
    music_title: reel.music_title ?? '',
    audio_muted: reel.audio_muted ?? false,
    cover_time_ms: reel.cover_time_ms ?? 0,
    cover_url: reel.cover_key ? await viewUrl(reel.cover_key) : null,
    trim_start_ms: reel.trim_start_ms,
    trim_end_ms: reel.trim_end_ms,
    likes_count: reel.likes_count,
    comments_count: reel.comments_count,
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

export async function createReel(
  author: UserDoc,
  input: {
    video_media_id: string;
    caption: string;
    location_name: string;
    location_lat?: number | null;
    location_lng?: number | null;
    filter?: string;
    music_title?: string;
    audio_muted?: boolean;
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
  const hashtags = extractHashtags(input.caption);
  if (hashtags.length > MAX_HASHTAGS) {
    throw ApiError.badRequest(`You can use up to ${MAX_HASHTAGS} hashtags.`, undefined, 'TOO_MANY_HASHTAGS');
  }
  const mentions = extractMentions(input.caption)
    .filter((n) => n !== author.username)
    .slice(0, MAX_MENTIONS);
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
      hashtags,
      mentions,
      location_name: input.location_name,
      location_lat: input.location_lat ?? null,
      location_lng: input.location_lng ?? null,
      filter: input.filter || 'normal',
      music_title: input.music_title ?? '',
      audio_muted: input.audio_muted ?? false,
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
  if (hashtags.length) {
    await Hashtag.bulkWrite(
      hashtags.map((name) => ({
        updateOne: { filter: { name }, update: { $inc: { post_count: 1 } }, upsert: true },
      })),
    );
  }
  return { reel: await toReelDto(author, reel, author, false), created: true };
}

export async function reelFeed(viewer: UserDoc, cursor: string | undefined, limit: number) {
  const take = pageOf(limit);
  const follows = await Follow.find({ follower_id: viewer._id, status: 'accepted' })
    .select('following_id')
    .lean();
  const filter: Record<string, unknown> = {
    author_id: { $in: await audienceIds(viewer._id, follows.map((f) => f.following_id)) },
    deleted_at: null,
  };
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

export async function toggleReelLike(viewer: UserDoc, reelId: string) {
  const { reel, author } = await visibleReel(viewer, reelId);
  const existing = await ReelLike.findOneAndDelete({ user_id: viewer._id, reel_id: reel._id });
  if (!existing) await ReelLike.create({ user_id: viewer._id, reel_id: reel._id });
  const delta = existing ? -1 : 1;
  await Reel.updateOne(
    { _id: reel._id, ...(delta < 0 ? { likes_count: { $gt: 0 } } : {}) },
    { $inc: { likes_count: delta } },
  );
  const fresh = (await Reel.findById(reel._id)) ?? reel;
  return toReelDto(viewer, fresh, author, !existing);
}

export async function deleteReel(viewer: UserDoc, reelId: string) {
  const reel = await Reel.findOne({ _id: reelId, author_id: viewer._id, deleted_at: null });
  if (!reel) throw ApiError.notFound('This reel is no longer available.');
  reel.deleted_at = new Date();
  await reel.save();
}

export async function addReelComment(viewer: UserDoc, reelId: string, body: string) {
  const { reel } = await visibleReel(viewer, reelId);
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
  return {
    id: comment.id as string,
    body: comment.body,
    author: {
      id: viewer.id as string,
      username: viewer.username,
      display_name: viewer.display_name,
      avatar_url: null,
    },
    created_at: (comment.get('created_at') as Date).toISOString(),
    replies: [],
  };
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
    items: page.map((c) => {
      const author = byId.get(c.author_id.toHexString());
      return {
        id: c.id as string,
        body: c.body,
        author: author
          ? { id: author.id, username: author.username, display_name: author.display_name }
          : null,
        created_at: (c.get('created_at') as Date).toISOString(),
      };
    }),
    next_cursor: rows.length > take ? (page[page.length - 1]!.id as string) : null,
  };
}
