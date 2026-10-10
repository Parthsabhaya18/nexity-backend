import type { RequestHandler } from 'express';

import { verifyAccessToken } from '../modules/auth/tokens';
import { User, type UserDoc } from '../modules/users/user.model';
import { ApiError } from '../utils/ApiError';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserDoc;
    /** Refresh token family of the device making the request; null for older tokens. */
    sessionId?: string | null;
  }
}

// JWT `iat` has one-second precision, so a token issued in the same second as a password change stays valid.
const IAT_PRECISION_MS = 1000;

const sessionEnded = () =>
  ApiError.unauthorized('Your session has ended. Please log in again.', 'INVALID_REFRESH_TOKEN');

/** Resolves an access token to an active user. Shared by REST and the chat socket handshake. */
export async function authenticateAccessToken(
  token: string,
): Promise<{ user: UserDoc; sessionId: string | null }> {
  const { userId, issuedAt, sessionId } = verifyAccessToken(token);
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Invalid access token');
  if (user.status === 'deleted') throw sessionEnded();
  if (issuedAt + IAT_PRECISION_MS < user.password_changed_at.getTime()) throw sessionEnded();
  if (user.status === 'disabled') {
    throw ApiError.forbidden('Your account has been disabled.', 'ACCOUNT_DISABLED');
  }
  return { user, sessionId };
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized('Missing access token');

  const { user, sessionId } = await authenticateAccessToken(token);
  req.user = user;
  req.sessionId = sessionId;
  next();
};
