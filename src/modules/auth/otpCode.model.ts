import mongoose from 'mongoose';

export const OTP_PURPOSES = ['verify_email', 'reset_password'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

const otpCodeSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: OTP_PURPOSES, required: true },
    code_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumed_at: { type: Date, default: null },
    last_sent_at: { type: Date, required: true },
    window_started_at: { type: Date, required: true },
    sends_in_window: { type: Number, default: 1 },
  },
  {
    collection: 'otp_codes',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } as const,
  },
);

otpCodeSchema.index({ user_id: 1, purpose: 1 }, { unique: true });

export const OtpCode = mongoose.model('OtpCode', otpCodeSchema);
