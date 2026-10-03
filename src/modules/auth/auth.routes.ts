import { Router } from 'express';

import { authLimiter, loginLimiter } from '../../middlewares/rateLimit';
import {
  forgotPassword,
  login,
  logout,
  refresh,
  register,
  resendVerification,
  resetPassword,
  usernameAvailable,
  verifyEmail,
  verifyResetCode,
} from './auth.controller';

export const authRouter = Router();

authRouter.use(authLimiter);

authRouter.post('/register', register);
authRouter.post('/login', loginLimiter, login);
authRouter.post('/verify-email', verifyEmail);
authRouter.post('/resend-verification', resendVerification);
authRouter.post('/forgot-password', forgotPassword);
authRouter.post('/verify-reset-code', verifyResetCode);
authRouter.post('/reset-password', resetPassword);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', logout);
authRouter.get('/username-available', usernameAvailable);
