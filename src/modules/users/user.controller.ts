import type { RequestHandler } from 'express';

import { deviceOf } from '../auth/auth.controller';
import * as auth from '../auth/auth.service';
import {
  changePasswordSchema,
  deleteAccountSchema,
  notificationSettingsSchema,
  preferencesSchema,
  sessionIdSchema,
  updateMeSchema,
} from './user.schema';
import * as users from './user.service';

export const updateMe: RequestHandler = async (req, res) => {
  res.json(await users.updateMe(req.user!, updateMeSchema.parse(req.body)));
};

export const updatePreferences: RequestHandler = async (req, res) => {
  res.json(await users.updatePreferences(req.user!, preferencesSchema.parse(req.body)));
};

export const updateNotificationSettings: RequestHandler = async (req, res) => {
  res.json(
    await users.updateNotificationSettings(req.user!, notificationSettingsSchema.parse(req.body)),
  );
};

export const changePassword: RequestHandler = async (req, res) => {
  const { current_password, new_password } = changePasswordSchema.parse(req.body);
  res.json(await auth.changePassword(req.user!, current_password, new_password, deviceOf(req)));
};

export const sessions: RequestHandler = async (req, res) => {
  res.json(await auth.sessions(req.user!, req.sessionId ?? null));
};

export const logoutSession: RequestHandler = async (req, res) => {
  const { sessionId } = sessionIdSchema.parse(req.params);
  await auth.logoutSession(req.user!, sessionId, req.sessionId ?? null);
  res.status(204).end();
};

export const logoutOtherSessions: RequestHandler = async (req, res) => {
  await auth.logoutOtherSessions(req.user!, req.sessionId ?? null);
  res.status(204).end();
};

export const deleteAccount: RequestHandler = async (req, res) => {
  const { password } = deleteAccountSchema.parse(req.body);
  await auth.deleteAccount(req.user!, password);
  res.status(204).end();
};
