import type { RequestHandler } from 'express';

import { userIdParamsSchema } from '../follows/follow.schema';
import * as extra from './post.extra';
import {
  commentBodySchema,
  createPostSchema,
  cursorQuerySchema,
  postIdParamsSchema,
  updatePostSchema,
} from './post.schema';
import * as posts from './post.service';

export const createPost: RequestHandler = async (req, res) => {
  const { post, created } = await posts.createPost(req.user!, createPostSchema.parse(req.body));
  res.status(created ? 201 : 200).json(post);
};

export const getPost: RequestHandler = async (req, res) => {
  const { postId } = postIdParamsSchema.parse(req.params);
  res.json(await posts.getPost(req.user!, postId));
};

const idOf = (req: { params: unknown }) => postIdParamsSchema.parse(req.params).postId;
const pageOf = (req: { query: unknown }) => cursorQuerySchema.parse(req.query);

export const updatePost: RequestHandler = async (req, res) => {
  res.json(await extra.updatePost(req.user!, idOf(req), updatePostSchema.parse(req.body)));
};

export const deletePost: RequestHandler = async (req, res) => {
  await extra.deletePost(req.user!, idOf(req));
  res.status(204).end();
};

export const likePost: RequestHandler = async (req, res) => {
  res.json(await extra.toggleLike(req.user!, idOf(req)));
};

export const likePostOn: RequestHandler = async (req, res) => {
  res.json(await extra.setLike(req.user!, idOf(req), true));
};

export const likePostOff: RequestHandler = async (req, res) => {
  res.json(await extra.setLike(req.user!, idOf(req), false));
};

export const savePost: RequestHandler = async (req, res) => {
  res.json(await extra.toggleSave(req.user!, idOf(req)));
};

export const postComments: RequestHandler = async (req, res) => {
  const { cursor, limit } = pageOf(req);
  res.json(await extra.listComments(req.user!, idOf(req), cursor, limit));
};

export const addPostComment: RequestHandler = async (req, res) => {
  const { body, parent_id } = commentBodySchema.parse(req.body);
  res.status(201).json(await extra.addComment(req.user!, idOf(req), body, parent_id));
};

export const postLikers: RequestHandler = async (req, res) => {
  const { cursor, limit } = pageOf(req);
  res.json(await extra.listLikers(req.user!, idOf(req), cursor, limit));
};

export const feed: RequestHandler = async (req, res) => {
  const { cursor, limit } = pageOf(req);
  res.json(await extra.feed(req.user!, cursor, limit));
};

export const saved: RequestHandler = async (req, res) => {
  const { cursor, limit } = pageOf(req);
  res.json(await extra.savedPosts(req.user!, cursor, limit));
};

export const userPosts: RequestHandler = async (req, res) => {
  const { userId } = userIdParamsSchema.parse(req.params);
  const { cursor, limit } = pageOf(req);
  res.json(await extra.postsByUser(req.user!, userId, cursor, limit));
};

export const removeComment: RequestHandler = async (req, res) => {
  await extra.deleteComment(req.user!, String(req.params.commentId));
  res.status(204).end();
};
