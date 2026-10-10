import mongoose from 'mongoose';

import { setActivityVisible } from '../../realtime/io';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { acceptAllPending } from '../follows/follow.service';
import { Media } from '../media/media.model';
import { deleteMedia } from '../media/media.service';
import { MONGO_DUPLICATE_KEY } from '../../utils/mongo';
import {
  NOTIFICATION_SETTING_KEYS,
  notificationSettingsOf,
  sharesActivity,
  toMeDto,
  User,
  type UserDoc,
} from './user.model';
import type { NotificationSettingsInput, PreferencesInput, UpdateMeInput } from './user.schema';


const usernameTaken = () =>
  ApiError.conflict('That username is taken. Try another.', 'USERNAME_TAKEN', {
    field: 'username',
  });

async function claimUsername(user: UserDoc, username: string) {
  if (username === user.username) return;
  const holder = await User.findOne({ username });
  if (holder && !holder._id.equals(user._id)) {
    if (holder.is_verified) throw usernameTaken();
    await holder.deleteOne();
  }
  user.username = username;
}

/** Returns the media id of the photo being replaced, if any. */
async function applyAvatar(user: UserDoc, mediaId: string | null) {
  const current = user.avatar_media_id ?? null;
  if (mediaId === null) {
    user.avatar_url = null;
    user.avatar_media_id = null;
    user.avatar_key = null;
    return current;
  }
  if (current?.equals(mediaId)) return null;

  const media = await Media.findOne({ _id: mediaId, owner_id: user._id });
  if (!media || media.status !== 'ready' || media.purpose !== 'avatar' || media.kind !== 'image') {
    throw ApiError.badRequest(
      "We couldn't use that photo. Please upload it again.",
      { field: 'avatar_media_id' },
      'INVALID_AVATAR',
    );
  }
  user.avatar_media_id = media._id;
  user.avatar_key = media.key;
  user.avatar_url = null;
  return current;
}

export async function updateMe(user: UserDoc, input: UpdateMeInput) {
  if (input.username !== undefined) await claimUsername(user, input.username);
  if (input.display_name !== undefined) user.display_name = input.display_name;
  if (input.bio !== undefined) user.bio = input.bio;
  if (input.website !== undefined) user.website = input.website;
  const goingPublic = user.is_private && input.is_private === false;
  if (input.is_private !== undefined) user.is_private = input.is_private;
  const activityChanged =
    input.show_activity_status !== undefined &&
    input.show_activity_status !== sharesActivity(user);
  if (input.show_activity_status !== undefined) {
    user.show_activity_status = input.show_activity_status;
  }
  if (input.message_privacy !== undefined) user.message_privacy = input.message_privacy;
  const replaced =
    input.avatar_media_id !== undefined ? await applyAvatar(user, input.avatar_media_id) : null;

  try {
    await user.save();
  } catch (err) {
    if (err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY) {
      throw usernameTaken();
    }
    throw err;
  }

  if (activityChanged) {
    setActivityVisible(user.id as string, sharesActivity(user), user.last_active_at ?? null);
  }
  if (replaced) {
    // The profile is already saved; a leftover file only costs storage.
    deleteMedia(user, replaced.toHexString()).catch((err: unknown) =>
      logger.warn({ err, mediaId: replaced.toHexString() }, 'Failed to delete old avatar'),
    );
  }
  if (goingPublic) {
    await acceptAllPending(user);
    return toMeDto((await User.findById(user._id)) ?? user);
  }
  return toMeDto(user);
}

export async function updateNotificationSettings(
  user: UserDoc,
  input: NotificationSettingsInput,
) {
  const next = { ...notificationSettingsOf(user) };
  for (const key of NOTIFICATION_SETTING_KEYS) {
    const value = input[key];
    if (value !== undefined) next[key] = value;
  }
  user.notification_settings = next;
  await user.save();
  return notificationSettingsOf(user);
}

/** A mood replaces Light / Dark / System until it is cleared. */
export async function updatePreferences(user: UserDoc, input: PreferencesInput) {
  if (input.theme !== undefined) {
    user.theme_preference = input.theme;
    if (input.mood === undefined) user.mood = null;
  }
  if (input.mood !== undefined) user.mood = input.mood;
  await user.save();
  return {
    theme: user.theme_preference,
    mood: user.mood ?? null,
    updated_at: (user.get('updated_at') as Date).toISOString(),
  };
}
