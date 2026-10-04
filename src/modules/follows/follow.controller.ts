import type { RequestHandler } from 'express';

import {
  connectionsQuerySchema,
  pageQuerySchema,
  requestIdParamsSchema,
  userIdParamsSchema,
  usernameParamsSchema,
} from './follow.schema';
import * as follows from './follow.service';

export const getProfile: RequestHandler = async (req, res) => {
  const { username } = usernameParamsSchema.parse(req.params);
  res.json(await follows.getProfile(req.user!, username));
};

export const follow: RequestHandler = async (req, res) => {
  const { userId } = userIdParamsSchema.parse(req.params);
  res.json(await follows.follow(req.user!, userId));
};

export const unfollow: RequestHandler = async (req, res) => {
  const { userId } = userIdParamsSchema.parse(req.params);
  await follows.unfollow(req.user!, userId);
  res.status(204).end();
};

export const removeFollower: RequestHandler = async (req, res) => {
  const { userId } = userIdParamsSchema.parse(req.params);
  await follows.removeFollower(req.user!, userId);
  res.status(204).end();
};

export const followers: RequestHandler = async (req, res) => {
  const { userId } = userIdParamsSchema.parse(req.params);
  res.json(
    await follows.listConnections(
      req.user!,
      userId,
      'followers',
      connectionsQuerySchema.parse(req.query),
    ),
  );
};

export const following: RequestHandler = async (req, res) => {
  const { userId } = userIdParamsSchema.parse(req.params);
  res.json(
    await follows.listConnections(
      req.user!,
      userId,
      'following',
      connectionsQuerySchema.parse(req.query),
    ),
  );
};

export const followRequests: RequestHandler = async (req, res) => {
  res.json(await follows.listFollowRequests(req.user!, pageQuerySchema.parse(req.query)));
};

export const acceptRequest: RequestHandler = async (req, res) => {
  const { id } = requestIdParamsSchema.parse(req.params);
  res.json(await follows.acceptFollowRequest(req.user!, id));
};

export const declineRequest: RequestHandler = async (req, res) => {
  const { id } = requestIdParamsSchema.parse(req.params);
  await follows.declineFollowRequest(req.user!, id);
  res.status(204).end();
};
