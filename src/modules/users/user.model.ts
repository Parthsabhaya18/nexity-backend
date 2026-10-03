import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

export const GENDERS = ['woman', 'man', 'non_binary', 'prefer_not_to_say'] as const;

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    display_name: { type: String, required: true, trim: true, maxlength: 50 },
    password_hash: { type: String, required: true, select: false },
    gender: { type: String, enum: GENDERS, required: true },
    date_of_birth: { type: Date, required: true },
    bio: { type: String, default: '', maxlength: 500 },
    avatar_url: { type: String, default: null },
    is_private: { type: Boolean, default: false },
    is_verified: { type: Boolean, default: false },
    role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    theme_preference: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
    onboarding_completed_at: { type: Date, default: null },
    failed_login_count: { type: Number, default: 0 },
    lock_until: { type: Date, default: null },
    password_changed_at: { type: Date, default: () => new Date() },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;

export const User = mongoose.model('User', userSchema);

/** Private shape for the signed-in user. Never return this for other users. */
export function toMeDto(user: UserDoc) {
  return {
    id: user.id as string,
    username: user.username,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url ?? null,
    bio: user.bio,
    gender: user.gender,
    date_of_birth: user.date_of_birth.toISOString().slice(0, 10),
    is_private: user.is_private,
    is_verified: user.is_verified,
    role: user.role,
    onboarding_completed: Boolean(user.onboarding_completed_at),
    preferences: { theme: user.theme_preference },
    created_at: (user.get('created_at') as Date).toISOString(),
  };
}
