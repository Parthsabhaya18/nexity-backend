import type { Request, RequestHandler } from 'express';

import { exposeDevOtp } from '../../config/env';
import { toMeDto } from '../users/user.model';
import {
  emailOnlySchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  usernameQuerySchema,
  verifyCodeSchema,
} from './auth.schema';
import * as auth from './auth.service';
import type { SendResult } from './otp.service';
import { RESEND_COOLDOWN_SECONDS } from './otp.service';
import type { DeviceInfo } from './tokens';

export function deviceOf(req: Request): DeviceInfo {
  const header = (name: string) => {
    const v = req.get(name);
    return v ? v.slice(0, 100) : null;
  };
  return {
    platform: header('X-Platform'),
    appVersion: header('X-App-Version'),
    userAgent: header('User-Agent'),
  };
}

function sendInfo(sent: SendResult | null) {
  return {
    resend_available_in: sent?.resendAvailableIn ?? RESEND_COOLDOWN_SECONDS,
    ...(exposeDevOtp && sent?.code ? { dev_code: sent.code } : {}),
  };
}

export const register: RequestHandler = async (req, res) => {
  const { user, sent } = await auth.register(registerSchema.parse(req.body));
  res.status(201).json({
    user: {
      id: user.id as string,
      username: user.username,
      email: user.email,
      is_verified: user.is_verified,
    },
    verification_sent: true,
    ...sendInfo(sent),
  });
};

export const verifyEmail: RequestHandler = async (req, res) => {
  const { email, code } = verifyCodeSchema.parse(req.body);
  res.json({ verified: true, ...(await auth.verifyEmail(email, code, deviceOf(req))) });
};

export const resendVerification: RequestHandler = async (req, res) => {
  const { email } = emailOnlySchema.parse(req.body);
  res.json({ sent: true, ...sendInfo(await auth.resendVerification(email)) });
};

export const login: RequestHandler = async (req, res) => {
  const result = await auth.login(loginSchema.parse(req.body), deviceOf(req));
  if (result.needsVerification) {
    res.status(403).json({
      error: {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email to continue. We sent a 6-digit code to your inbox.',
        details: { email: result.user.email, ...sendInfo(result.sent) },
      },
    });
    return;
  }
  res.json(result.session);
};

export const forgotPassword: RequestHandler = async (req, res) => {
  const { email } = emailOnlySchema.parse(req.body);
  res.json({ sent: true, ...sendInfo(await auth.forgotPassword(email)) });
};

export const verifyResetCode: RequestHandler = async (req, res) => {
  const { email, code } = verifyCodeSchema.parse(req.body);
  res.json(await auth.verifyResetCode(email, code));
};

export const resetPassword: RequestHandler = async (req, res) => {
  const { reset_token, password } = resetPasswordSchema.parse(req.body);
  await auth.resetPassword(reset_token, password);
  res.status(204).end();
};

export const refresh: RequestHandler = async (req, res) => {
  const { refresh_token } = refreshSchema.parse(req.body);
  res.json(await auth.refresh(refresh_token, deviceOf(req)));
};

export const logout: RequestHandler = async (req, res) => {
  const { refresh_token } = refreshSchema.parse(req.body);
  await auth.logout(refresh_token);
  res.status(204).end();
};

export const usernameAvailable: RequestHandler = async (req, res) => {
  const { username } = usernameQuerySchema.parse(req.query);
  res.json(await auth.isUsernameAvailable(username));
};

export const me: RequestHandler = async (req, res) => {
  res.json(await toMeDto(req.user!));
};
