import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

import { Follow } from '../follows/follow.model';
import { viewUrl } from '../media/media.storage';

export const GENDERS = ['woman', 'man', 'non_binary', 'prefer_not_to_say'] as const;

/** Instagram's limits. */
export const BIO_MAX = 150;
export const WEBSITE_MAX = 200;

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    display_name: { type: String, required: true, trim: true, maxlength: 50 },
    password_hash: { type: String, required: true, select: false },
    gender: { type: String, enum: GENDERS, required: true },
    date_of_birth: { type: Date, required: true },
    bio: { type: String, default: '', maxlength: BIO_MAX },
    website: { type: String, default: '', maxlength: WEBSITE_MAX },
    /** External photo URL; uploaded avatars use `avatar_key` instead. */
    avatar_url: { type: String, default: null },
    /** Owned `avatar` media; deleted from S3 when replaced. */
    avatar_media_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', default: null },
    /** S3 key of `avatar_media_id`; the viewable URL is built per response. */
    avatar_key: { type: String, default: null },
    is_private: { type: Boolean, default: false },
    /** Denormalised so profile headers need no count queries. */
    posts_count: { type: Number, default: 0, min: 0 },
    followers_count: { type: Number, default: 0, min: 0 },
    following_count: { type: Number, default: 0, min: 0 },
    is_verified: { type: Boolean, default: false },
    role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    theme_preference: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
    /** When set, it replaces Light / Dark / System for the whole app. */
    mood: {
      type: String,
      enum: [
        'happy',
        'calm',
        'romantic',
        'sad',
        'angry',
        'cool',
        'relaxed',
        'excited',
        'tired',
        'motivated',
        null,
      ],
      default: null,
    },
    onboarding_completed_at: { type: Date, default: null },
    failed_login_count: { type: Number, default: 0 },
    lock_until: { type: Date, default: null },
    password_changed_at: { type: Date, default: () => new Date() },
    /** Set when the user's last chat socket disconnects; powers "Active 5m ago". */
    last_active_at: { type: Date, default: null },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;

userSchema.index({ display_name: 1 });

export const User = mongoose.model('User', userSchema);

export async function avatarUrlOf(user: Pick<UserAttrs, 'avatar_key' | 'avatar_url'>) {
  return user.avatar_key ? viewUrl(user.avatar_key) : (user.avatar_url ?? null);
}

export interface PublicUserSource {
  _id: mongoose.Types.ObjectId;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  avatar_key?: string | null;
  last_active_at?: Date | null;
}

/** Swaps uploaded avatars (`avatar_key`) for a viewable URL before building DTOs. */
export function withAvatarUrls<T extends PublicUserSource>(users: readonly T[]): Promise<T[]> {
  return Promise.all(
    users.map(async (u) =>
      u.avatar_key ? { ...u, avatar_url: await viewUrl(u.avatar_key) } : u,
    ),
  );
}

/** Shape safe to show to other users. */
export function toPublicUserDto(user: PublicUserSource) {
  return {
    id: user._id.toString(),
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url ?? null,
    last_active_at: user.last_active_at ? user.last_active_at.toISOString() : null,
  };
}

export const PUBLIC_USER_FIELDS =
  '_id username display_name avatar_url avatar_key last_active_at';

/** Private shape for the signed-in user. Never return this for other users. */
export async function toMeDto(user: UserDoc) {
  const [avatarUrl, followRequests] = await Promise.all([
    avatarUrlOf(user),
    Follow.countDocuments({ following_id: user._id, status: 'pending' }),
  ]);
  return {
    id: user.id as string,
    username: user.username,
    email: user.email,
    display_name: user.display_name,
    avatar_url: avatarUrl,
    bio: user.bio,
    website: user.website ?? '',
    gender: user.gender,
    date_of_birth: user.date_of_birth.toISOString().slice(0, 10),
    is_private: user.is_private,
    is_verified: user.is_verified,
    posts_count: user.posts_count ?? 0,
    followers_count: user.followers_count ?? 0,
    following_count: user.following_count ?? 0,
    follow_requests_count: followRequests,
    role: user.role,
    onboarding_completed: Boolean(user.onboarding_completed_at),
    preferences: { theme: user.theme_preference, mood: user.mood ?? null },
    created_at: (user.get('created_at') as Date).toISOString(),
  };
}
