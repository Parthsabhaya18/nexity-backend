import mongoose, { type Types } from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import { User, type UserDoc } from '../users/user.model';
import { Mute } from './mute.model';

const MONGO_DUPLICATE_KEY = 11000;

export async function muteUser(viewer: UserDoc, targetId: string) {
  if (viewer._id.equals(targetId)) {
    throw ApiError.badRequest("You can't mute yourself.", undefined, 'CANNOT_MUTE_SELF');
  }
  const target = await User.findById(targetId);
  if (!target || target.status !== 'active') throw ApiError.notFound('User not found');
  try {
    await Mute.create({ muter_id: viewer._id, muted_id: target._id });
  } catch (err) {
    if (!(err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY)) {
      throw err;
    }
  }
}

export async function unmuteUser(viewer: UserDoc, targetId: string) {
  await Mute.deleteOne({ muter_id: viewer._id, muted_id: targetId });
}

export async function isMuted(viewerId: Types.ObjectId, targetId: Types.ObjectId) {
  return !!(await Mute.exists({ muter_id: viewerId, muted_id: targetId }));
}

/** Authors the viewer muted, for feeds that should skip them. */
export async function mutedIdsFor(viewerId: Types.ObjectId) {
  const rows = await Mute.find({ muter_id: viewerId }).select('muted_id').lean();
  return rows.map((r) => r.muted_id);
}
