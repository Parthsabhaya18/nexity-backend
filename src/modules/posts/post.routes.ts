import { Router } from 'express';

import { postCreateLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { objectIdSchema } from '../follows/follow.schema';
import {
  addPostComment,
  createPost,
  deletePost,
  feed,
  getPost,
  likePost,
  postComments,
  postLikers,
  removeComment,
  savePost,
  saved,
  tagPosts,
  updatePost,
  userPosts,
} from './post.controller';

export const postsRouter = Router();
export const feedRouter = Router();
export const commentsRouter = Router();
export const tagsRouter = Router();

postsRouter.use(requireAuth);
postsRouter.post('/', postCreateLimiter, createPost);
postsRouter.post('/:postId/like', likePost);
postsRouter.post('/:postId/save', savePost);
postsRouter.get('/:postId/comments', postComments);
postsRouter.post('/:postId/comments', addPostComment);
postsRouter.get('/:postId/likers', postLikers);
postsRouter.patch('/:postId', updatePost);
postsRouter.delete('/:postId', deletePost);
postsRouter.get('/:postId', getPost);

feedRouter.use(requireAuth);
feedRouter.get('/', feed);

commentsRouter.use(requireAuth);
commentsRouter.delete('/:commentId', (req, res, next) => {
  if (!objectIdSchema.safeParse(req.params.commentId).success) {
    next();
    return;
  }
  return removeComment(req, res, next);
});

tagsRouter.use(requireAuth);
tagsRouter.get('/:tag/posts', tagPosts);

export { saved as savedPosts, userPosts };
