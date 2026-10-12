import bcrypt from 'bcryptjs';
import type { z } from 'zod';

import { ApiError } from '../../utils/ApiError';
import { Follow } from '../follows/follow.model';
import { User, type UserDoc, toMeDto } from '../users/user.model';
import type { loginSchema, registerSchema } from './auth.schema';
import { consumeOtp, sendOtp, type SendResult } from './otp.service';
import {
  type DeviceInfo,
  issueTokenPair,
  listSessions,
  RESET_TOKEN_EXPIRES_IN,
  revokeAllUserTokens,
  revokeRefreshFamily,
  revokeSession,
  rotateRefreshToken,
  signResetToken,
  verifyResetToken,
} from './tokens';

const BCRYPT_COST = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// Compared against when the user doesn't exist, so response time doesn't reveal registered emails.
const DUMMY_HASH = bcrypt.hashSync('nexity-dummy-password', BCRYPT_COST);

const invalidCredentials = () =>
  ApiError.unauthorized('Incorrect email, username or password.', 'INVALID_CREDENTIALS');

async function session(user: UserDoc, device: DeviceInfo) {
  return { ...(await issueTokenPair(user.id as string, device)), user: await toMeDto(user) };
}

export async function register(input: z.infer<typeof registerSchema>) {
  const [byEmail, byUsername] = await Promise.all([
    User.findOne({ email: input.email }),
    User.findOne({ username: input.username }),
  ]);

  if (byEmail?.is_verified) {
    throw ApiError.conflict(
      'An account with this email already exists. Try logging in.',
      'EMAIL_TAKEN',
      {
        field: 'email',
      },
    );
  }
  if (byUsername && !byUsername._id.equals(byEmail?._id)) {
    if (byUsername.is_verified) {
      throw ApiError.conflict('That username is taken. Try another.', 'USERNAME_TAKEN', {
        field: 'username',
      });
    }
    // An unfinished sign-up must not lock the username. Drop it so this attempt can claim it.
    await byUsername.deleteOne();
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const fields = {
    username: input.username,
    display_name: input.display_name,
    password_hash: passwordHash,
    gender: input.gender,
    date_of_birth: input.date_of_birth,
    password_changed_at: new Date(),
  };

  // An unverified sign-up with the same email is replaced, so an abandoned attempt never blocks the address.
  let user: UserDoc;
  if (byEmail) {
    byEmail.set(fields);
    user = await byEmail.save();
  } else {
    user = await User.create({ email: input.email, ...fields });
  }

  const sent = await sendOtpIgnoringCooldown(user, 'verify_email');
  return { user, sent };
}

/** Re-registering or logging in should not fail just because a code was sent seconds ago. */
async function sendOtpIgnoringCooldown(
  user: UserDoc,
  purpose: 'verify_email' | 'reset_password',
): Promise<SendResult> {
  try {
    return await sendOtp(user, purpose);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'RESEND_COOLDOWN') {
      const { retry_after_seconds } = err.details as { retry_after_seconds: number };
      return { resendAvailableIn: retry_after_seconds };
    }
    throw err;
  }
}

export async function verifyEmail(email: string, code: string, device: DeviceInfo) {
  const user = await User.findOne({ email });
  if (!user) {
    throw ApiError.badRequest(
      'This code has expired. Tap “Resend code” to get a new one.',
      undefined,
      'CODE_EXPIRED',
    );
  }
  if (!user.is_verified) {
    await consumeOtp(user._id, 'verify_email', code);
    user.is_verified = true;
    await user.save();
  }
  return session(user, device);
}

export async function resendVerification(email: string): Promise<SendResult | null> {
  const user = await User.findOne({ email });
  if (!user || user.is_verified) return null;
  return sendOtp(user, 'verify_email');
}

export async function login(input: z.infer<typeof loginSchema>, device: DeviceInfo) {
  const query = input.identifier.includes('@')
    ? { email: input.identifier }
    : { username: input.identifier };
  const user = await User.findOne(query).select('+password_hash');

  if (!user) {
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw invalidCredentials();
  }

  if (user.lock_until && user.lock_until.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lock_until.getTime() - Date.now()) / 60_000);
    throw ApiError.tooMany(
      `Too many wrong attempts. For your safety, this account is locked. Try again in ${minutes} min or reset your password.`,
      { retry_after_seconds: minutes * 60 },
    );
  }

  const ok = await bcrypt.compare(input.password, user.password_hash);
  if (!ok) {
    user.failed_login_count += 1;
    if (user.failed_login_count >= MAX_FAILED_LOGINS) {
      user.failed_login_count = 0;
      user.lock_until = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await user.save();
      throw ApiError.tooMany(
        `Too many wrong attempts. Your account is locked for ${LOCK_MINUTES} minutes. You can reset your password to get back in now.`,
        { retry_after_seconds: LOCK_MINUTES * 60 },
      );
    }
    await user.save();
    throw invalidCredentials();
  }

  if (user.failed_login_count || user.lock_until) {
    user.failed_login_count = 0;
    user.lock_until = null;
    await user.save();
  }

  if (user.status === 'disabled') {
    throw ApiError.forbidden(
      'Your account has been disabled. Contact support@nexity.app if you think this is a mistake.',
      'ACCOUNT_DISABLED',
    );
  }

  if (!user.is_verified) {
    const sent = await sendOtpIgnoringCooldown(user, 'verify_email');
    return { needsVerification: true as const, user, sent };
  }

  return { needsVerification: false as const, session: await session(user, device) };
}

export async function forgotPassword(email: string): Promise<SendResult | null> {
  const user = await User.findOne({ email });
  if (!user || user.status === 'disabled') return null;
  return sendOtp(user, 'reset_password');
}

export async function verifyResetCode(email: string, code: string) {
  const user = await User.findOne({ email });
  if (!user) {
    throw ApiError.badRequest(
      'That code isn’t right. Check your email and try again.',
      undefined,
      'INVALID_CODE',
    );
  }
  await consumeOtp(user._id, 'reset_password', code);
  return {
    reset_token: signResetToken(user.id as string, user.password_changed_at),
    expires_in: RESET_TOKEN_EXPIRES_IN,
  };
}

export async function resetPassword(resetToken: string, password: string) {
  const { userId, passwordVersion } = verifyResetToken(resetToken);
  const user = await User.findById(userId);
  if (!user || user.password_changed_at.getTime() !== passwordVersion) {
    throw ApiError.badRequest(
      'This reset link has expired. Please request a new code.',
      undefined,
      'INVALID_RESET_TOKEN',
    );
  }

  user.set({
    password_hash: await bcrypt.hash(password, BCRYPT_COST),
    password_changed_at: new Date(),
    failed_login_count: 0,
    lock_until: null,
    // Entering a code sent to the inbox proves ownership of the email.
    is_verified: true,
  });
  await user.save();
  await revokeAllUserTokens(user._id);
}

export async function refresh(refreshToken: string, device: DeviceInfo) {
  const { userId, tokens } = await rotateRefreshToken(refreshToken, device);
  const user = await User.findById(userId);
  if (!user || user.status === 'disabled') {
    await revokeAllUserTokens(userId);
    throw ApiError.unauthorized(
      'Your session has ended. Please log in again.',
      'INVALID_REFRESH_TOKEN',
    );
  }
  return tokens;
}

export async function logout(refreshToken: string) {
  await revokeRefreshFamily(refreshToken);
}

async function withPassword(user: UserDoc) {
  const loaded = await User.findById(user._id).select('+password_hash');
  if (!loaded) throw ApiError.unauthorized('Your session has ended. Please log in again.');
  return loaded;
}

/**
 * Every other device is signed out. The caller's access token is now too old to use,
 * so a fresh session for this device is returned.
 */
export async function changePassword(
  user: UserDoc,
  currentPassword: string,
  newPassword: string,
  device: DeviceInfo,
) {
  const loaded = await withPassword(user);
  if (!(await bcrypt.compare(currentPassword, loaded.password_hash))) {
    throw ApiError.badRequest(
      "That's not your current password.",
      { field: 'current_password' },
      'INVALID_PASSWORD',
    );
  }
  if (await bcrypt.compare(newPassword, loaded.password_hash)) {
    throw ApiError.badRequest(
      "Choose a password you haven't used.",
      { field: 'new_password' },
      'PASSWORD_REUSED',
    );
  }
  loaded.set({
    password_hash: await bcrypt.hash(newPassword, BCRYPT_COST),
    password_changed_at: new Date(),
  });
  await loaded.save();
  await revokeAllUserTokens(loaded._id);
  return issueTokenPair(loaded.id as string, device);
}

const deviceName = (platform: string | null | undefined) =>
  platform === 'android'
    ? 'Android phone'
    : platform === 'ios'
      ? 'iPhone'
      : platform === 'web'
        ? 'Web browser'
        : 'Unknown device';

export async function sessions(user: UserDoc, currentSessionId: string | null) {
  const rows = await listSessions(user._id);
  const items = rows.map((r) => ({
    id: r.family_id,
    device: deviceName(r.platform),
    platform: r.platform ?? null,
    app_version: r.app_version ?? null,
    last_active_at: (r.last_used_at ?? (r as { created_at?: Date }).created_at ?? new Date()).toISOString(),
    current: r.family_id === currentSessionId,
  }));
  items.sort((a, b) => Number(b.current) - Number(a.current));
  return { items };
}

export async function logoutSession(user: UserDoc, sessionId: string, currentSessionId: string | null) {
  if (sessionId === currentSessionId) {
    throw ApiError.badRequest(
      'Use Log out to sign out of this device.',
      undefined,
      'CURRENT_SESSION',
    );
  }
  if (!(await revokeSession(user._id, sessionId))) {
    throw ApiError.notFound('That device is already logged out.');
  }
}

export async function logoutOtherSessions(user: UserDoc, currentSessionId: string | null) {
  // Tokens from before session ids existed can't say which device is "this one".
  if (!currentSessionId) {
    throw ApiError.conflict('Refresh and try again.', 'SESSION_UNKNOWN');
  }
  await revokeAllUserTokens(user._id, { exceptFamily: currentSessionId });
}

/**
 * The row is kept (chats and comments point at it) but hidden everywhere: every lookup
 * filters on `status: 'active'`. Email and username are released for new sign-ups.
 */
export async function deleteAccount(user: UserDoc, password: string) {
  const loaded = await withPassword(user);
  if (!(await bcrypt.compare(password, loaded.password_hash))) {
    throw ApiError.badRequest("That's not your password.", { field: 'password' }, 'INVALID_PASSWORD');
  }

  const rows = await Follow.find({
    $or: [{ follower_id: loaded._id }, { following_id: loaded._id }],
    status: 'accepted',
  })
    .select('follower_id following_id')
    .lean();
  const followed = rows.filter((r) => r.follower_id.equals(loaded._id)).map((r) => r.following_id);
  const followers = rows.filter((r) => r.following_id.equals(loaded._id)).map((r) => r.follower_id);
  await Promise.all([
    User.updateMany(
      { _id: { $in: followed }, followers_count: { $gt: 0 } },
      { $inc: { followers_count: -1 } },
    ),
    User.updateMany(
      { _id: { $in: followers }, following_count: { $gt: 0 } },
      { $inc: { following_count: -1 } },
    ),
  ]);
  await Follow.deleteMany({ $or: [{ follower_id: loaded._id }, { following_id: loaded._id }] });

  const id = loaded.id as string;
  loaded.set({
    status: 'deleted',
    email: `deleted-${id}@deleted.nexity.invalid`,
    username: `deleted_${id}`,
    display_name: 'Deleted account',
    bio: '',
    website: '',
    avatar_url: null,
    followers_count: 0,
    following_count: 0,
    password_changed_at: new Date(),
  });
  await loaded.save();
  await revokeAllUserTokens(loaded._id);
}

export async function isUsernameAvailable(raw: string) {
  const username = raw.trim().toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(username)) return { available: false, reason: 'invalid' as const };
  const holder = await User.findOne({ username });
  // Only a verified account owns the name. An abandoned OTP attempt stays available.
  if (holder?.is_verified) return { available: false, reason: 'taken' as const };
  return { available: true };
}
