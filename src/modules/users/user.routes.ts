import { Router } from 'express';

import {
  followLimiter,
  passwordLimiter,
  profileUpdateLimiter,
  searchLimiter,
} from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { me } from '../auth/auth.controller';
import {
  follow,
  followers,
  following,
  followRequests,
  getProfile,
  removeFollower,
  unfollow,
} from '../follows/follow.controller';
import { userPosts } from '../posts/post.controller';
import { savedPosts } from '../posts/post.routes';
import { savedAll, userReels } from '../reels/reel.routes';
import { block, blocked, mute, unblock, unmute } from '../safety/safety.controller';
import { mentionSuggestions, suggestions } from '../search/search.controller';
import {
  changePassword,
  deleteAccount,
  logoutOtherSessions,
  logoutSession,
  sessions,
  updateMe,
  updateNotificationSettings,
  updatePreferences,
} from './user.controller';
import { searchUsers } from './user.search';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/me', me);
usersRouter.get('/suggestions', searchLimiter, suggestions);
/** The `@` picker in post and reel captions. */
usersRouter.get('/mention-suggestions', searchLimiter, mentionSuggestions);
/** People picker for New message. */
usersRouter.get('/search', searchLimiter, searchUsers);
usersRouter.patch('/me', profileUpdateLimiter, updateMe);
usersRouter.patch('/me/preferences', profileUpdateLimiter, updatePreferences);
usersRouter.patch('/me/notification-settings', profileUpdateLimiter, updateNotificationSettings);
usersRouter.post('/me/password', passwordLimiter, changePassword);
usersRouter.get('/me/sessions', sessions);
usersRouter.delete('/me/sessions', profileUpdateLimiter, logoutOtherSessions);
usersRouter.delete('/me/sessions/:sessionId', profileUpdateLimiter, logoutSession);
usersRouter.delete('/me', passwordLimiter, deleteAccount);
usersRouter.get('/me/saved-posts', savedPosts);
/** Saved posts and reels together, for the Saved grid and viewer. */
usersRouter.get('/me/saved', savedAll);
usersRouter.get('/me/blocked', blocked);
usersRouter.get('/:userId/posts', userPosts);
usersRouter.get('/:userId/reels', userReels);
usersRouter.get('/me/follow-requests', followRequests);
usersRouter.delete('/me/followers/:userId', followLimiter, removeFollower);
usersRouter.get('/by-username/:username', getProfile);
usersRouter.get('/:userId/followers', followers);
usersRouter.get('/:userId/following', following);
usersRouter.post('/:userId/follow', followLimiter, follow);
usersRouter.delete('/:userId/follow', followLimiter, unfollow);
usersRouter.post('/:userId/block', followLimiter, block);
usersRouter.delete('/:userId/block', followLimiter, unblock);
usersRouter.post('/:userId/mute', followLimiter, mute);
usersRouter.delete('/:userId/mute', followLimiter, unmute);
