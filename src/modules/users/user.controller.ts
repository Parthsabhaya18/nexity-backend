import type { RequestHandler } from 'express';

import { preferencesSchema, updateMeSchema } from './user.schema';
import * as users from './user.service';

export const updateMe: RequestHandler = async (req, res) => {
  res.json(await users.updateMe(req.user!, updateMeSchema.parse(req.body)));
};

export const updatePreferences: RequestHandler = async (req, res) => {
  res.json(await users.updatePreferences(req.user!, preferencesSchema.parse(req.body)));
};
