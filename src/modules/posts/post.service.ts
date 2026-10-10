import mongoose from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { canViewContent, findVisibleUser, toUserSummaries } from '../follows/follow.service';
import { blockIdsFor, isBlockedEither } from '../safety/block.service';
import { Media } from '../media/media.model';
import { viewUrl } from '../media/media.storage';
import { User, type UserDoc } from '../users/user.model';
import { extractMentions, MAX_MENTIONS } from './caption';
import { PostLike, PostSave } from './post.engage.model';
import { Post, type PostDoc } from './post.model';
import type { CreatePostInput } from './post.schema';
import { MONGO_DUPLICATE_KEY } from '../../utils/mongo';


const isDuplicateKey = (err: unknown) =>
  err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY;

/** Tagged accounts the viewer may still see (active, not blocked either way). */
export async function taggedUsers(viewer: UserDoc, post: { tagged_ids?: mongoose.Types.ObjectId[] }) {
  const ids = post.tagged_ids ?? [];
  if (!ids.length) return [];
  const hidden = new Set((await blockIdsFor(viewer._id)).map((id) => id.toHexString()));
  const users = await User.find({ _id: { $in: ids }, status: 'active' });
  const byId = new Map(users.map((u) => [u.id as string, u]));
  const ordered = ids.flatMap((id) => {
    const user = byId.get(id.toHexString());
    return user && !hidden.has(id.toHexString()) ? [user] : [];
  });
  return toUserSummaries(viewer, ordered);
}

export async function toPostDto(
  viewer: UserDoc,
  post: PostDoc,
  author: UserDoc,
  flags?: { liked: boolean; saved: boolean },
) {
  const [summary] = await toUserSummaries(viewer, [author]);
  const isOwner = author._id.equals(viewer._id);
  return {
    id: post.id as string,
    author: summary!,
    media: await Promise.all(
      post.media.map(async (m) => ({
        id: m.media_id.toHexString(),
        kind: m.kind,
        url: await viewUrl(m.key),
        width: m.width ?? null,
        height: m.height ?? null,
        alt_text: m.alt_text ?? '',
        duration_ms: m.duration_ms ?? null,
      })),
    ),
    caption: post.caption,
    mentions: post.mentions,
    tagged_users: await taggedUsers(viewer, post),
    location_name: post.location_name,
    location_lat: post.location_lat ?? null,
    location_lng: post.location_lng ?? null,
    adjustments: {
      brightness: post.adjustments?.brightness ?? 0,
      contrast: post.adjustments?.contrast ?? 0,
      saturation: post.adjustments?.saturation ?? 0,
      warmth: post.adjustments?.warmth ?? 0,
      fade: post.adjustments?.fade ?? 0,
      sharpen: post.adjustments?.sharpen ?? 0,
      blur: post.adjustments?.blur ?? 0,
      vignette: post.adjustments?.vignette ?? 0,
    },
    aspect_ratio: post.aspect_ratio,
    /** Hidden from everyone, the owner included, while `hide_like_count` is on. */
    likes_count: post.hide_like_count ? null : post.likes_count,
    comments_count: post.comments_count,
    hide_like_count: post.hide_like_count,
    comments_disabled: post.comments_disabled,
    liked_by_me: flags?.liked ?? false,
    saved_by_me: flags?.saved ?? false,
    is_owner: isOwner,
    created_at: (post.get('created_at') as Date).toISOString(),
    updated_at: (post.get('updated_at') as Date).toISOString(),
  };
}

const invalidMedia = () =>
  ApiError.badRequest(
    "Some photos didn't finish uploading. Please try again.",
    { field: 'media_ids' },
    'INVALID_MEDIA',
  );

/** Ready `post` uploads owned by the author, in the order given. */
async function loadMedia(author: UserDoc, ids: string[]) {
  const rows = await Media.find({ _id: { $in: ids }, owner_id: author._id });
  const byId = new Map(rows.map((m) => [m.id as string, m]));
  const ordered = ids.map((id) => byId.get(id.toLowerCase()));
  if (ordered.some((m) => !m || m.status !== 'ready' || m.purpose !== 'post')) {
    throw invalidMedia();
  }
  if (await Post.exists({ 'media.media_id': { $in: ids } })) {
    throw ApiError.conflict('One of these photos is already in another post.', 'MEDIA_IN_USE', {
      field: 'media_ids',
    });
  }
  return ordered.map((m) => m!);
}

async function resolveMentions(author: UserDoc, usernames: string[]) {
  if (!usernames.length) return [];
  const users = await User.find({
    username: { $in: usernames },
    status: 'active',
    is_verified: true,
  })
    .select('_id username')
    .lean();
  const byName = new Map(users.map((u) => [u.username, u._id]));
  return usernames.flatMap((name) => {
    const id = byName.get(name);
    return id ? [{ id, username: name }] : [];
  });
}

/** People who can be tagged: active, verified, and not blocked either way. */
async function resolveTagged(author: UserDoc, ids: string[]) {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))].filter(
    (id) => id !== (author.id as string),
  );
  if (!unique.length) return [];
  const hidden = new Set((await blockIdsFor(author._id)).map((id) => id.toHexString()));
  const users = await User.find({ _id: { $in: unique }, status: 'active', is_verified: true })
    .select('_id')
    .lean();
  const found = new Set(users.map((u) => u._id.toHexString()));
  const valid = unique.filter((id) => found.has(id) && !hidden.has(id));
  if (valid.length !== unique.length) {
    throw ApiError.badRequest(
      "Some of the people you tagged can't be tagged.",
      { field: 'tagged_user_ids' },
      'INVALID_TAG',
    );
  }
  return valid.map((id) => new mongoose.Types.ObjectId(id));
}

async function findExisting(author: UserDoc, clientUploadId: string | undefined) {
  if (!clientUploadId) return null;
  return Post.findOne({ author_id: author._id, client_upload_id: clientUploadId });
}

export async function createPost(author: UserDoc, input: CreatePostInput) {
  const existing = await findExisting(author, input.client_upload_id);
  if (existing) return { post: await toPostDto(author, existing, author), created: false };

  const mentionNames = extractMentions(input.caption).filter((n) => n !== author.username);
  if (mentionNames.length > MAX_MENTIONS) {
    throw ApiError.badRequest(
      `You can mention up to ${MAX_MENTIONS} people.`,
      { field: 'caption' },
      'TOO_MANY_MENTIONS',
    );
  }

  const media = await loadMedia(author, input.media_ids);
  const mentions = await resolveMentions(author, mentionNames);
  const taggedIds = await resolveTagged(author, input.tagged_user_ids);

  let post: PostDoc;
  try {
    post = await Post.create({
      author_id: author._id,
      media: media.map((m, i) => ({
        media_id: m._id,
        key: m.key,
        kind: m.kind,
        width: m.width,
        height: m.height,
        alt_text: input.alt_texts[i] ?? '',
        duration_ms: m.duration_ms,
      })),
      caption: input.caption,
      mention_ids: mentions.map((m) => m.id),
      mentions: mentions.map((m) => m.username),
      tagged_ids: taggedIds,
      location_name: input.location_name,
      location_lat: input.location_lat ?? null,
      location_lng: input.location_lng ?? null,
      adjustments: input.adjustments ?? undefined,
      aspect_ratio: input.aspect_ratio,
      hide_like_count: input.hide_like_count,
      comments_disabled: input.comments_disabled,
      client_upload_id: input.client_upload_id ?? null,
    });
  } catch (err) {
    // A retry raced the first request past the lookup above.
    if (isDuplicateKey(err)) {
      const raced = await findExisting(author, input.client_upload_id);
      if (raced) return { post: await toPostDto(author, raced, author), created: false };
    }
    throw err;
  }

  await User.updateOne({ _id: author._id }, { $inc: { posts_count: 1 } });
  return { post: await toPostDto(author, post, author), created: true };
}

export async function getPost(viewer: UserDoc, postId: string) {
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
  const [liked, saved] = await Promise.all([
    PostLike.exists({ user_id: viewer._id, post_id: post._id }),
    PostSave.exists({ user_id: viewer._id, post_id: post._id }),
  ]);
  return toPostDto(viewer, post, author, { liked: !!liked, saved: !!saved });
}
