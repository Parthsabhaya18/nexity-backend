import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { apiRouter } from './routes';
import { EMAIL_LOGO_PATH, emailLogoPng } from './utils/emailLayout';
import { logger } from './utils/logger';

export function createApp() {
  const app = express();
  const logoPng = emailLogoPng();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));

  app.get(EMAIL_LOGO_PATH, (_req, res) => {
    res
      .set('Cross-Origin-Resource-Policy', 'cross-origin')
      .set('Cache-Control', 'public, max-age=604800')
      .type('png')
      .send(logoPng);
  });

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
