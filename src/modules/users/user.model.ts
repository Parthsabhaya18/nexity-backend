import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

import { Follow } from '../follows/follow.model';
import { viewUrl } from '../media/media.storage';

export const PLAN_IDS = ['free', 'plus', 'premium'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Sign-up offers man / woman / other; the rest stay valid for existing accounts. */
export const GENDERS = ['woman', 'man', 'other', 'non_binary', 'prefer_not_to_say'] as const;

/** Instagram's limits. */
export const BIO_MAX = 150;
export const WEBSITE_MAX = 200;

export const MESSAGE_PRIVACY = ['everyone', 'following'] as const;
export const NOTIFICATION_SETTING_KEYS = ['paused', 'comments', 'story_likes'] as const;
export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];

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
    /** `deleted` accounts keep their row so foreign keys stay valid; email and username are released. */
    status: { type: String, enum: ['active', 'disabled', 'deleted'], default: 'active' },
    /** Off hides "Active now" / "Active 5m ago" from everyone. */
    show_activity_status: { type: Boolean, default: true },
    /** `following`: only people this user follows can start or continue a chat. */
    message_privacy: { type: String, enum: MESSAGE_PRIVACY, default: 'everyone' },
    notification_settings: {
      paused: { type: Boolean, default: false },
      comments: { type: Boolean, default: true },
      story_likes: { type: Boolean, default: true },
    },
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
    /** Denormalised current plan. Treated as Free once `expires_at` has passed. */
    entitlement: {
      plan: { type: String, enum: PLAN_IDS, default: 'free' },
      expires_at: { type: Date, default: null },
      source: { type: String, default: null },
      updated_at: { type: Date, default: null },
      /** Razorpay billing for the current plan; only the payments service writes these. */
      period: { type: String, enum: ['monthly', 'quarterly', 'yearly', null], default: null },
      autopay: { type: Boolean, default: false },
      razorpay_subscription_id: { type: String, default: null },
      /** Full price of one period (what AutoPay renews at, and what an upgrade credit is based on). */
      price_paise: { type: Number, default: null },
      /** What was paid for the current period (after coupons / credits). */
      paid_paise: { type: Number, default: null },
      period_started_at: { type: Date, default: null },
      next_charge_at: { type: Date, default: null },
      cancel_at_period_end: { type: Boolean, default: false },
      /** `in_grace` while Razorpay retries a failed renewal. */
      billing_status: { type: String, enum: ['active', 'in_grace', 'canceled', null], default: null },
      /** Masked only: "UPI · @okhdfcbank", "Visa •••• 4242". */
      method_display: { type: String, default: null },
      /** Last expiry reminder sent ("3d:<expires_at>"), so each one goes out once. */
      reminded: { type: String, default: null },
    },
    /** Opt-in Nearby settings. Never part of any public DTO. */
    nearby: {
      enabled: { type: Boolean, default: false },
      bluetooth_enabled: { type: Boolean, default: false },
      location_enabled: { type: Boolean, default: false },
      notifications_enabled: { type: Boolean, default: false },
      timezone: { type: String, default: 'Asia/Kolkata' },
      consented_at: { type: Date, default: null },
      updated_at: { type: Date, default: null },
      /** Last Bluetooth sighting report. Not returned to clients. */
      ble_reported_at: { type: Date, default: null },
    },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;

userSchema.index({ display_name: 1 });
userSchema.index({ 'nearby.enabled': 1 });

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
  show_activity_status?: boolean | null;
}

/** False when the user turned "Show activity status" off. */
export const sharesActivity = (user: { show_activity_status?: boolean | null } | null | undefined) =>
  user?.show_activity_status !== false;

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
    last_active_at:
      user.last_active_at && sharesActivity(user) ? user.last_active_at.toISOString() : null,
  };
}

export const PUBLIC_USER_FIELDS =
  '_id username display_name avatar_url avatar_key last_active_at show_activity_status';

/** Missing keys (accounts created before the setting existed) read as on. */
export function notificationSettingsOf(user: Pick<UserAttrs, 'notification_settings'>) {
  const s = user.notification_settings;
  return {
    paused: s?.paused === true,
    comments: s?.comments !== false,
    story_likes: s?.story_likes !== false,
  };
}

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
    privacy: {
      show_activity_status: sharesActivity(user),
      message_privacy: user.message_privacy ?? 'everyone',
    },
    notification_settings: notificationSettingsOf(user),
    password_changed_at: user.password_changed_at.toISOString(),
    created_at: (user.get('created_at') as Date).toISOString(),
  };
}
