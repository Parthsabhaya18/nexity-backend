import mongoose, { type Types } from 'mongoose';

import { isOnline } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { userSearchFilter } from '../../utils/regex';
import { isBlockedEither } from '../safety/block.service';
import { avatarUrlOf, User, type UserDoc } from '../users/user.model';
import { Follow } from './follow.model';
import type { ConnectionsQuery, PageQuery } from './follow.schema';

export type FollowStatus = 'none' | 'pending' | 'accepted';

const MONGO_DUPLICATE_KEY = 11000;

const userNotFound = () => ApiError.notFound('User not found');

const isVisible = (user: UserDoc | null): user is UserDoc =>
  !!user && user.status === 'active' && user.is_verified;

export async function findVisibleUser(userId: string) {
  const user = await User.findById(userId);
  if (!isVisible(user)) throw userNotFound();
  return user;
}

/** Counts are denormalised on users; decrements never go below zero. */
async function adjustCounts(
  followerId: Types.ObjectId,
  followingId: Types.ObjectId,
  delta: 1 | -1,
) {
  const guard = (field: string) => (delta < 0 ? { [field]: { $gt: 0 } } : {});
  await Promise.all([
    User.updateOne(
      { _id: followerId, ...guard('following_count') },
      { $inc: { following_count: delta } },
    ),
    User.updateOne(
      { _id: followingId, ...guard('followers_count') },
      { $inc: { followers_count: delta } },
    ),
  ]);
}

async function statusesFor(viewer: UserDoc, userIds: Types.ObjectId[]) {
  const rows = await Follow.find({ follower_id: viewer._id, following_id: { $in: userIds } })
    .select('following_id status')
    .lean();
  return new Map(rows.map((r) => [r.following_id.toHexString(), r.status as FollowStatus]));
}

/** List row for any user, with the viewer's follow state. */
export async function toUserSummaries(viewer: UserDoc, users: UserDoc[]) {
  const statuses = await statusesFor(
    viewer,
    users.map((u) => u._id),
  );
  return Promise.all(
    users.map(async (u) => ({
      id: u.id as string,
      username: u.username,
      display_name: u.display_name,
      avatar_url: await avatarUrlOf(u),
      is_private: u.is_private,
      is_self: u._id.equals(viewer._id),
      follow_status: statuses.get(u.id as string) ?? ('none' as FollowStatus),
    })),
  );
}

/** Loads users by id keeping the given order; hidden accounts are dropped. */
async function usersInOrder(ids: Types.ObjectId[]) {
  const users = await User.find({ _id: { $in: ids } });
  const byId = new Map(users.map((u) => [u.id as string, u]));
  return ids.map((id) => byId.get(id.toHexString()) ?? null).filter(isVisible);
}

export async function follow(viewer: UserDoc, targetId: string) {
  if (viewer._id.equals(targetId)) {
    throw ApiError.badRequest("You can't follow yourself.", undefined, 'CANNOT_FOLLOW_SELF');
  }
  const target = await findVisibleUser(targetId);
  if (await isBlockedEither(viewer._id, target._id)) throw userNotFound();
  const existing = await Follow.findOne({ follower_id: viewer._id, following_id: target._id });
  if (existing) return { status: existing.status as FollowStatus };

  const status: FollowStatus = target.is_private ? 'pending' : 'accepted';
  try {
    await Follow.create({ follower_id: viewer._id, following_id: target._id, status });
  } catch (err) {
    // A double tap raced us; the first request already created the row.
    if (err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY) {
      const row = await Follow.findOne({ follower_id: viewer._id, following_id: target._id });
      return { status: (row?.status ?? status) as FollowStatus };
    }
    throw err;
  }
  if (status === 'accepted') await adjustCounts(viewer._id, target._id, 1);
  return { status };
}

/** Unfollows, or cancels a pending request. */
export async function unfollow(viewer: UserDoc, targetId: string) {
  const removed = await Follow.findOneAndDelete({
    follower_id: viewer._id,
    following_id: targetId,
  });
  if (removed?.status === 'accepted') await adjustCounts(viewer._id, removed.following_id, -1);
}

export async function removeFollower(me: UserDoc, followerId: string) {
  const removed = await Follow.findOneAndDelete({ follower_id: followerId, following_id: me._id });
  if (removed?.status === 'accepted') await adjustCounts(removed.follower_id, me._id, -1);
}

async function followStatus(viewer: UserDoc, target: UserDoc): Promise<FollowStatus> {
  const row = await Follow.findOne({ follower_id: viewer._id, following_id: target._id })
    .select('status')
    .lean();
  return (row?.status as FollowStatus | undefined) ?? 'none';
}

/** Private accounts show posts only to themselves and accepted followers. Blocks hide both ways. */
export async function canViewContent(viewer: UserDoc, author: UserDoc) {
  if (await isBlockedEither(viewer._id, author._id)) return false;
  if (author._id.equals(viewer._id) || !author.is_private) return true;
  return (await followStatus(viewer, author)) === 'accepted';
}

export async function getProfile(viewer: UserDoc, username: string) {
  const user = await User.findOne({ username });
  if (!isVisible(user)) throw userNotFound();
  const isSelf = user._id.equals(viewer._id);
  if (!isSelf && (await isBlockedEither(viewer._id, user._id))) throw userNotFound();
  const [status, followsYou] = isSelf
    ? (['none', false] as const)
    : await Promise.all([
        followStatus(viewer, user),
        Follow.exists({ follower_id: user._id, following_id: viewer._id, status: 'accepted' }),
      ]);

  return {
    id: user.id as string,
    username: user.username,
    display_name: user.display_name,
    avatar_url: await avatarUrlOf(user),
    bio: user.bio,
    website: user.website ?? '',
    is_private: user.is_private,
    is_verified: user.is_verified,
    posts_count: user.posts_count ?? 0,
    followers_count: user.followers_count ?? 0,
    following_count: user.following_count ?? 0,
    is_self: isSelf,
    follow_status: status,
    follows_you: Boolean(followsYou),
    can_view_content: isSelf || !user.is_private || status === 'accepted',
    presence: {
      online: isOnline(user.id as string),
      last_active_at: user.last_active_at ? user.last_active_at.toISOString() : null,
    },
  };
}

export async function listConnections(
  viewer: UserDoc,
  userId: string,
  kind: 'followers' | 'following',
  { cursor, limit, q }: ConnectionsQuery,
) {
  const target = await findVisibleUser(userId);
  if (target.is_private && !target._id.equals(viewer._id)) {
    if ((await followStatus(viewer, target)) !== 'accepted') {
      throw ApiError.forbidden(
        'This account is private. Follow them to see who they follow.',
        'PRIVATE_ACCOUNT',
      );
    }
  }

  const own = kind === 'followers' ? 'following_id' : 'follower_id';
  const other = kind === 'followers' ? 'follower_id' : 'following_id';
  const match: Record<string, unknown> = { [own]: target._id, status: 'accepted' };
  if (cursor) match._id = { $lt: new mongoose.Types.ObjectId(cursor) };

  const search = q
    ? userSearchFilter(q).$or.map((cond) => {
        const [field, value] = Object.entries(cond)[0]!;
        return { [`user.${field}`]: value };
      })
    : null;

  const rows = await Follow.aggregate<{ _id: Types.ObjectId; other: Types.ObjectId }>([
    { $match: match },
    { $sort: { _id: -1 } },
    ...(search
      ? [
          { $lookup: { from: 'users', localField: other, foreignField: '_id', as: 'user' } },
          { $match: { $or: search } },
        ]
      : []),
    { $limit: limit + 1 },
    { $project: { other: `$${other}` } },
  ]);

  const page = rows.slice(0, limit);
  const users = await usersInOrder(page.map((r) => r.other));
  return {
    items: await toUserSummaries(viewer, users),
    next_cursor: rows.length > limit ? page[page.length - 1]!._id.toHexString() : null,
  };
}

export async function listFollowRequests(me: UserDoc, { cursor, limit }: PageQuery) {
  const filter: Record<string, unknown> = { following_id: me._id, status: 'pending' };
  const [rows, total] = await Promise.all([
    Follow.find(cursor ? { ...filter, _id: { $lt: cursor } } : filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean(),
    Follow.countDocuments(filter),
  ]);
  const page = rows.slice(0, limit);
  const users = await usersInOrder(page.map((r) => r.follower_id));
  const summaries = new Map((await toUserSummaries(me, users)).map((s) => [s.id, s] as const));
  return {
    items: page.flatMap((r) => {
      const user = summaries.get(r.follower_id.toHexString());
      return user
        ? [{ id: r._id.toHexString(), user, created_at: r.created_at.toISOString() }]
        : [];
    }),
    total,
    next_cursor: rows.length > limit ? page[page.length - 1]!._id.toHexString() : null,
  };
}

export async function acceptFollowRequest(me: UserDoc, requestId: string) {
  const accepted = await Follow.findOneAndUpdate(
    { _id: requestId, following_id: me._id, status: 'pending' },
    { status: 'accepted' },
    { returnDocument: 'after' },
  );
  if (!accepted) {
    const row = await Follow.findOne({ _id: requestId, following_id: me._id });
    if (row?.status !== 'accepted') {
      throw ApiError.notFound('This request is no longer available.');
    }
    return followerSummary(me, row.follower_id);
  }
  await adjustCounts(accepted.follower_id, me._id, 1);
  return followerSummary(me, accepted.follower_id);
}

async function followerSummary(me: UserDoc, followerId: Types.ObjectId) {
  const [user] = await usersInOrder([followerId]);
  return { user: user ? (await toUserSummaries(me, [user]))[0]! : null };
}

export async function declineFollowRequest(me: UserDoc, requestId: string) {
  await Follow.deleteOne({ _id: requestId, following_id: me._id, status: 'pending' });
}

/** Switching to a public account approves everyone who asked, like Instagram. */
export async function acceptAllPending(me: UserDoc) {
  const pending = await Follow.find({ following_id: me._id, status: 'pending' })
    .select('_id')
    .lean();
  for (const { _id } of pending) {
    const accepted = await Follow.findOneAndUpdate(
      { _id, status: 'pending' },
      { status: 'accepted' },
      { returnDocument: 'after' },
    );
    if (accepted) await adjustCounts(accepted.follower_id, me._id, 1);
  }
}
