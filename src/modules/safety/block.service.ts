import mongoose, { type Types } from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { Follow } from '../follows/follow.model';
import { avatarUrlOf, User, type UserDoc } from '../users/user.model';
import { Block } from './block.model';

const MONGO_DUPLICATE_KEY = 11000;

async function dropFollow(followerId: Types.ObjectId, followingId: Types.ObjectId) {
  const removed = await Follow.findOneAndDelete({
    follower_id: followerId,
    following_id: followingId,
  });
  if (removed?.status !== 'accepted') return;
  await Promise.all([
    User.updateOne(
      { _id: followerId, following_count: { $gt: 0 } },
      { $inc: { following_count: -1 } },
    ),
    User.updateOne(
      { _id: followingId, followers_count: { $gt: 0 } },
      { $inc: { followers_count: -1 } },
    ),
  ]);
}

/** Either person blocked the other. Hidden both ways; only the blocker can undo it. */
export async function isBlockedEither(a: Types.ObjectId, b: Types.ObjectId) {
  if (a.equals(b)) return false;
  const row = await Block.exists({
    $or: [
      { blocker_id: a, blocked_id: b },
      { blocker_id: b, blocked_id: a },
    ],
  });
  return !!row;
}

export async function blockIdsFor(userId: Types.ObjectId) {
  const rows = await Block.find({
    $or: [{ blocker_id: userId }, { blocked_id: userId }],
  })
    .select('blocker_id blocked_id')
    .lean();
  const ids = new Set<string>();
  for (const row of rows) {
    const other = row.blocker_id.equals(userId) ? row.blocked_id : row.blocker_id;
    ids.add(other.toHexString());
  }
  return [...ids].map((id) => new mongoose.Types.ObjectId(id));
}

/** Author ids a feed or story tray may include: you, plus follows who are not blocked. */
export async function audienceIds(viewerId: Types.ObjectId, followingIds: Types.ObjectId[]) {
  const hidden = new Set((await blockIdsFor(viewerId)).map((id) => id.toHexString()));
  return [viewerId, ...followingIds.filter((id) => !hidden.has(id.toHexString()))];
}

export async function blockUser(viewer: UserDoc, targetId: string) {
  if (viewer._id.equals(targetId)) {
    throw ApiError.badRequest("You can't block yourself.", undefined, 'CANNOT_BLOCK_SELF');
  }
  const target = await User.findById(targetId);
  if (!target || target.status !== 'active') throw ApiError.notFound('User not found');
  try {
    await Block.create({ blocker_id: viewer._id, blocked_id: target._id });
  } catch (err) {
    if (!(err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY)) {
      throw err;
    }
  }
  await Promise.all([
    dropFollow(viewer._id, target._id),
    dropFollow(target._id, viewer._id),
  ]);
}

export async function unblockUser(viewer: UserDoc, targetId: string) {
  await Block.deleteOne({ blocker_id: viewer._id, blocked_id: targetId });
}

export async function listBlocked(viewer: UserDoc) {
  const rows = await Block.find({ blocker_id: viewer._id }).sort({ _id: -1 }).limit(100);
  const users = await User.find({ _id: { $in: rows.map((r) => r.blocked_id) }, status: 'active' });
  const byId = new Map(users.map((u) => [u.id as string, u]));
  const items = [];
  for (const row of rows) {
    const user = byId.get(row.blocked_id.toHexString());
    if (!user) continue;
    items.push({
      id: user.id as string,
      username: user.username,
      display_name: user.display_name,
      avatar_url: await avatarUrlOf(user),
    });
  }
  return { items };
}
