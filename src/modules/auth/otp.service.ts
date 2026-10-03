import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import type { Types } from 'mongoose';

import { jwtAccessSecret } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { sendMail } from '../../utils/mailer';
import { OtpCode, type OtpPurpose } from './otpCode.model';

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 30;
const MAX_SENDS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;

const hashCode = (userId: string, purpose: OtpPurpose, code: string) =>
  createHmac('sha256', jwtAccessSecret).update(`${userId}:${purpose}:${code}`).digest('hex');

export interface SendResult {
  /** Seconds until another code can be requested. */
  resendAvailableIn: number;
  /** Plain code, absent when no new code was sent. Only returned to clients when `exposeDevOtp` is true. */
  code?: string;
}

/**
 * Creates a fresh code (replacing any previous one) and emails it.
 * Throws `RESEND_COOLDOWN` / `TOO_MANY_CODES` when asked too often.
 */
export async function sendOtp(
  user: { _id: Types.ObjectId; email: string; display_name: string },
  purpose: OtpPurpose,
): Promise<SendResult> {
  const now = Date.now();
  const existing = await OtpCode.findOne({ user_id: user._id, purpose });

  if (existing) {
    const waitMs = existing.last_sent_at.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now;
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      throw ApiError.tooMany(
        `Please wait ${retryAfter}s before requesting another code.`,
        { retry_after_seconds: retryAfter },
        'RESEND_COOLDOWN',
      );
    }
    const windowOpen = now - existing.window_started_at.getTime() < HOUR_MS;
    if (windowOpen && existing.sends_in_window >= MAX_SENDS_PER_HOUR) {
      throw ApiError.tooMany(
        'Too many codes requested. Please try again in an hour.',
        undefined,
        'TOO_MANY_CODES',
      );
    }
  }

  const code = randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
  const windowOpen = existing && now - existing.window_started_at.getTime() < HOUR_MS;

  await OtpCode.findOneAndUpdate(
    { user_id: user._id, purpose },
    {
      $set: {
        code_hash: hashCode(user._id.toString(), purpose, code),
        expires_at: new Date(now + OTP_TTL_MINUTES * 60 * 1000),
        attempts: 0,
        consumed_at: null,
        last_sent_at: new Date(now),
        window_started_at: windowOpen ? existing.window_started_at : new Date(now),
        sends_in_window: windowOpen ? existing.sends_in_window + 1 : 1,
      },
    },
    { upsert: true },
  );

  await sendMail(buildEmail(user, purpose, code));
  return { resendAvailableIn: RESEND_COOLDOWN_SECONDS, code };
}

/** Checks a code and marks it used. Throws `INVALID_CODE` / `CODE_EXPIRED`. */
export async function consumeOtp(userId: Types.ObjectId, purpose: OtpPurpose, code: string) {
  const record = await OtpCode.findOne({ user_id: userId, purpose, consumed_at: null });
  const expired = () =>
    ApiError.badRequest(
      'This code has expired. Tap “Resend code” to get a new one.',
      undefined,
      'CODE_EXPIRED',
    );

  if (!record || record.expires_at.getTime() < Date.now()) throw expired();
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw ApiError.badRequest(
      'Too many wrong attempts. Tap “Resend code” to get a new one.',
      undefined,
      'CODE_EXPIRED',
    );
  }

  const expected = Buffer.from(record.code_hash, 'hex');
  const actual = Buffer.from(hashCode(userId.toString(), purpose, code), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    record.attempts += 1;
    await record.save();
    throw ApiError.badRequest(
      'That code isn’t right. Check your email and try again.',
      { attempts_left: Math.max(0, MAX_VERIFY_ATTEMPTS - record.attempts) },
      'INVALID_CODE',
    );
  }

  record.consumed_at = new Date();
  await record.save();
}

function buildEmail(
  user: { email: string; display_name: string },
  purpose: OtpPurpose,
  code: string,
) {
  const firstName = user.display_name.split(' ')[0] || 'there';
  const isReset = purpose === 'reset_password';
  const subject = isReset
    ? `${code} is your Nexity password reset code`
    : `${code} is your Nexity verification code`;
  const intro = isReset
    ? 'Use this code to reset your Nexity password.'
    : 'Use this code to verify your email and finish creating your Nexity account.';
  const text = `Hi ${firstName},\n\n${intro}\n\n${code}\n\nThe code expires in ${OTP_TTL_MINUTES} minutes. If you didn’t ask for it, you can ignore this email.\n\n— Nexity`;
  const html = `<!doctype html><html><body style="margin:0;background:#EFF8FF;font-family:Arial,Helvetica,sans-serif;color:#0F2747">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#FFFFFF;border:1px solid #CFE5FA;border-radius:16px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<p style="margin:0 0 8px;font-size:20px;font-weight:bold">Hi ${escapeHtml(firstName)},</p>
<p style="margin:0 0 24px;color:#58708C;font-size:15px">${intro}</p>
<p style="margin:0 0 24px;font-size:34px;letter-spacing:10px;font-weight:bold;color:#1D4ED8">${code}</p>
<p style="margin:0;color:#58708C;font-size:13px">The code expires in ${OTP_TTL_MINUTES} minutes. If you didn’t ask for it, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: user.email, subject, text, html };
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
