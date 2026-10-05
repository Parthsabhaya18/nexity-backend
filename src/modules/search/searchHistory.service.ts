import { ApiError } from '../../utils/ApiError';
import { toUserSummaries } from '../follows/follow.service';
import { blockIdsFor } from '../safety/block.service';
import { User, type UserDoc } from '../users/user.model';
import { SearchHistory } from './searchHistory.model';

/** Entries kept per user; the oldest fall off. */
export const HISTORY_LIMIT = 30;
const HISTORY_SHOWN = 20;

/**
 * Recent searches, newest first. Accounts that were blocked, deactivated or
 * unverified since are left out, so a blocked user never reappears here.
 */
export async function listHistory(viewer: UserDoc) {
  const [rows, hidden] = await Promise.all([
    SearchHistory.find({ user_id: viewer._id })
      .sort({ updated_at: -1 })
      .limit(HISTORY_LIMIT)
      .lean(),
    blockIdsFor(viewer._id),
  ]);
  const blocked = new Set(hidden.map((id) => id.toHexString()));
  const users = await User.find({
    _id: { $in: rows.map((r) => r.target_id) },
    status: 'active',
    is_verified: true,
  });
  const byId = new Map(users.map((u) => [u.id as string, u]));
  const ordered = rows.flatMap((r) => {
    const id = r.target_id.toHexString();
    const user = byId.get(id);
    return user && !blocked.has(id) ? [user] : [];
  });
  return toUserSummaries(viewer, ordered.slice(0, HISTORY_SHOWN));
}

export async function addHistory(viewer: UserDoc, targetId: string) {
  if (viewer._id.equals(targetId)) return;
  const target = await User.findById(targetId).select('_id status').lean();
  if (!target || target.status !== 'active') throw ApiError.notFound('User not found');
  await SearchHistory.updateOne(
    { user_id: viewer._id, target_id: target._id },
    { $set: { updated_at: new Date() } },
    { upsert: true },
  );
  const extra = await SearchHistory.find({ user_id: viewer._id })
    .sort({ updated_at: -1 })
    .skip(HISTORY_LIMIT)
    .select('_id')
    .lean();
  if (extra.length) await SearchHistory.deleteMany({ _id: { $in: extra.map((r) => r._id) } });
}

export async function removeHistory(viewer: UserDoc, targetId: string) {
  await SearchHistory.deleteOne({ user_id: viewer._id, target_id: targetId });
}

export async function clearHistory(viewer: UserDoc) {
  await SearchHistory.deleteMany({ user_id: viewer._id });
}
