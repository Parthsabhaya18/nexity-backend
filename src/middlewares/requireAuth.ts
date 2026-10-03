import type { RequestHandler } from 'express';

import { verifyAccessToken } from '../modules/auth/tokens';
import { User, type UserDoc } from '../modules/users/user.model';
import { ApiError } from '../utils/ApiError';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserDoc;
  }
}

// JWT `iat` has one-second precision, so a token issued in the same second as a password change stays valid.
const IAT_PRECISION_MS = 1000;

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized('Missing access token');

  const { userId, issuedAt } = verifyAccessToken(token);
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Invalid access token');
  if (issuedAt + IAT_PRECISION_MS < user.password_changed_at.getTime()) {
    throw ApiError.unauthorized(
      'Your session has ended. Please log in again.',
      'INVALID_REFRESH_TOKEN',
    );
  }
  if (user.status === 'disabled') {
    throw ApiError.forbidden('Your account has been disabled.', 'ACCOUNT_DISABLED');
  }

  req.user = user;
  next();
};
