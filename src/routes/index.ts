import { Router } from 'express';

import { authRouter } from '../modules/auth/auth.routes';
import { followRequestsRouter } from '../modules/follows/follow.routes';
import { gifsRouter } from '../modules/gifs/gifs.routes';
import { healthRouter } from '../modules/health/health.routes';
import { mediaRouter } from '../modules/media/media.routes';
import { conversationsRouter } from '../modules/messages/messages.routes';
import { commentsRouter, feedRouter, postsRouter } from '../modules/posts/post.routes';
import { reelsRouter } from '../modules/reels/reel.routes';
import { searchRouter } from '../modules/search/search.routes';
import { notificationsRouter } from '../modules/notifications/notification.routes';
import { reportsRouter } from '../modules/safety/safety.routes';
import { sharesRouter } from '../modules/shares/share.routes';
import { storiesRouter } from '../modules/stories/story.routes';
import { supportRouter } from '../modules/support/support.routes';
import { usersRouter } from '../modules/users/user.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/media', mediaRouter);
apiRouter.use('/follow-requests', followRequestsRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/posts', postsRouter);
apiRouter.use('/feed', feedRouter);
apiRouter.use('/comments', commentsRouter);
apiRouter.use('/stories', storiesRouter);
apiRouter.use('/reels', reelsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/gifs', gifsRouter);
apiRouter.use('/shares', sharesRouter);
apiRouter.use('/support', supportRouter);
