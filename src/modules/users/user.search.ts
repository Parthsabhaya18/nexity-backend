import type { RequestHandler } from 'express';
import { z } from 'zod';

import {
  PUBLIC_USER_FIELDS,
  type PublicUserSource,
  toPublicUserDto,
  User,
  withAvatarUrls,
} from './user.model';

const searchQuerySchema = z.object({
  q: z.string().trim().max(50).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** People picker for New message. An empty query returns the newest active accounts as suggestions. */
export const searchUsers: RequestHandler = async (req, res) => {
  const { q, limit } = searchQuerySchema.parse(req.query);
  const me = req.user!;
  const term = q.replace(/^@/, '');

  const filter: Record<string, unknown> = {
    _id: { $ne: me._id },
    status: 'active',
    is_verified: true,
  };
  if (term) {
    const pattern = escapeRegex(term);
    filter.$or = [
      { username: { $regex: `^${pattern.toLowerCase()}` } },
      { display_name: { $regex: pattern, $options: 'i' } },
    ];
  }

  const users = await User.find(filter)
    .select(PUBLIC_USER_FIELDS)
    .sort(term ? { username: 1 } : { created_at: -1 })
    .limit(limit)
    .lean<PublicUserSource[]>();

  res.json({ data: (await withAvatarUrls(users)).map(toPublicUserDto) });
};
