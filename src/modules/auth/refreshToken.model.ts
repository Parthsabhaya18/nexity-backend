import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    family_id: { type: String, required: true, index: true },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    platform: { type: String, default: null },
    app_version: { type: String, default: null },
    user_agent: { type: String, default: null },
    last_used_at: { type: Date, default: () => new Date() },
  },
  {
    collection: 'refresh_tokens',
    timestamps: { createdAt: 'created_at', updatedAt: false } as const,
  },
);

refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
