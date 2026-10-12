import { createHash, randomBytes, randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';

import { env, jwtAccessSecret } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { RefreshToken } from './refreshToken.model';

const DAY_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_SECONDS = 15 * 60;

export interface DeviceInfo {
  platform?: string | null;
  appVersion?: string | null;
  userAgent?: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** `sid` is the refresh token family, so a request knows which device session it belongs to. */
export function signAccessToken(userId: string, sessionId: string) {
  return jwt.sign({ typ: 'access', sid: sessionId }, jwtAccessSecret, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Returns the user id, or throws `TOKEN_EXPIRED` / `UNAUTHORIZED`. */
export function verifyAccessToken(token: string): {
  userId: string;
  issuedAt: number;
  sessionId: string | null;
} {
  try {
    const payload = jwt.verify(token, jwtAccessSecret) as jwt.JwtPayload;
    if (payload.typ !== 'access' || !payload.sub) throw new Error('wrong token type');
    return {
      userId: payload.sub,
      issuedAt: (payload.iat ?? 0) * 1000,
      sessionId: typeof payload.sid === 'string' ? payload.sid : null,
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Session expired', 'TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid access token');
  }
}

async function createRefreshToken(
  userId: Types.ObjectId | string,
  familyId: string,
  device: DeviceInfo,
) {
  const token = randomBytes(48).toString('base64url');
  await RefreshToken.create({
    user_id: userId,
    token_hash: sha256(token),
    family_id: familyId,
    expires_at: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
    platform: device.platform ?? null,
    app_version: device.appVersion ?? null,
    user_agent: device.userAgent ?? null,
  });
  return token;
}

/** Starts a new device session (new refresh token family). */
export async function issueTokenPair(userId: string, device: DeviceInfo): Promise<TokenPair> {
  const familyId = randomUUID();
  const refresh = await createRefreshToken(userId, familyId, device);
  return {
    access_token: signAccessToken(userId, familyId),
    refresh_token: refresh,
    expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

const invalidRefresh = () =>
  ApiError.unauthorized('Your session has ended. Please log in again.', 'INVALID_REFRESH_TOKEN');

/**
 * Rotates a refresh token. Reusing an already-rotated token revokes the whole family,
 * which signs that device out (theft detection).
 */
export async function rotateRefreshToken(token: string, device: DeviceInfo) {
  const now = new Date();
  const current = await RefreshToken.findOneAndUpdate(
    { token_hash: sha256(token), revoked_at: null, expires_at: { $gt: now } },
    { $set: { revoked_at: now, last_used_at: now } },
  );

  if (!current) {
    const reused = await RefreshToken.findOne({ token_hash: sha256(token) });
    if (reused?.revoked_at) {
      await RefreshToken.updateMany(
        { family_id: reused.family_id, revoked_at: null },
        { $set: { revoked_at: now } },
      );
    }
    throw invalidRefresh();
  }

  const userId = current.user_id.toString();
  const refresh = await createRefreshToken(userId, current.family_id, {
    platform: device.platform ?? current.platform,
    appVersion: device.appVersion ?? current.app_version,
    userAgent: device.userAgent ?? current.user_agent,
  });
  return {
    userId,
    tokens: {
      access_token: signAccessToken(userId, current.family_id),
      refresh_token: refresh,
      expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
    } satisfies TokenPair,
  };
}

export async function revokeRefreshFamily(token: string) {
  const found = await RefreshToken.findOne({ token_hash: sha256(token) });
  if (!found) return;
  await RefreshToken.updateMany(
    { family_id: found.family_id, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );
}

export async function revokeAllUserTokens(
  userId: Types.ObjectId | string,
  { exceptFamily }: { exceptFamily?: string | null } = {},
) {
  await RefreshToken.updateMany(
    {
      user_id: userId,
      revoked_at: null,
      ...(exceptFamily ? { family_id: { $ne: exceptFamily } } : {}),
    },
    { $set: { revoked_at: new Date() } },
  );
}

/** Signed-in devices: one row per refresh token family that still has a live token. */
export async function listSessions(userId: Types.ObjectId | string) {
  const rows = await RefreshToken.find({
    user_id: userId,
    revoked_at: null,
    expires_at: { $gt: new Date() },
  })
    .sort({ last_used_at: -1 })
    .lean();
  const byFamily = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byFamily.has(row.family_id)) byFamily.set(row.family_id, row);
  return [...byFamily.values()];
}

/** Returns false when the session doesn't exist or isn't this user's. */
export async function revokeSession(userId: Types.ObjectId | string, familyId: string) {
  const res = await RefreshToken.updateMany(
    { user_id: userId, family_id: familyId, revoked_at: null },
    { $set: { revoked_at: new Date() } },
  );
  return res.modifiedCount > 0;
}

/** Short-lived token proving the reset code was entered. Bound to the current password version. */
export function signResetToken(userId: string, passwordChangedAt: Date) {
  return jwt.sign({ typ: 'pwd_reset', pwv: passwordChangedAt.getTime() }, jwtAccessSecret, {
    subject: userId,
    expiresIn: RESET_TOKEN_TTL_SECONDS,
  });
}

export function verifyResetToken(token: string): { userId: string; passwordVersion: number } {
  const invalid = ApiError.badRequest(
    'This reset link has expired. Please request a new code.',
    undefined,
    'INVALID_RESET_TOKEN',
  );
  try {
    const payload = jwt.verify(token, jwtAccessSecret) as jwt.JwtPayload;
    if (payload.typ !== 'pwd_reset' || !payload.sub || typeof payload.pwv !== 'number')
      throw invalid;
    return { userId: payload.sub, passwordVersion: payload.pwv };
  } catch {
    throw invalid;
  }
}

export const RESET_TOKEN_EXPIRES_IN = RESET_TOKEN_TTL_SECONDS;
