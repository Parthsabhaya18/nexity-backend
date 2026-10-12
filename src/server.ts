import { createServer, type Server } from 'node:http';

import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { env, isMediaConfigured, paymentsMode } from './config/env';
import { startMediaCleanup, stopMediaCleanup } from './modules/media/media.cleanup';
import { registerChatHandlers } from './modules/messages/messages.socket';
import { startNearbyCleanup, stopNearbyCleanup } from './modules/nearby/nearby.cleanup';
import { startPaymentsJob, stopPaymentsJob } from './modules/payments/payments.jobs';
import { startStoryCleanup, stopStoryCleanup } from './modules/stories/story.cleanup';
import { refreshPlans } from './modules/subscriptions/plans';
import { attachRealtime, closeRealtime } from './realtime/io';
import { startKeepAlive, stopKeepAlive } from './utils/keepAlive';
import { logger } from './utils/logger';

let server: Server | undefined;
let shuttingDown = false;

async function start() {
  await connectDatabase();
  await connectRedis();
  await refreshPlans(true);

  server = createServer(createApp());
  attachRealtime(server, registerChatHandlers);
  server.listen(env.PORT, env.HOST, () => {
    logger.info(`Nexity API listening on http://${env.HOST}:${env.PORT}${env.API_PREFIX}`);
    startKeepAlive();
    startMediaCleanup();
    startStoryCleanup();
    startNearbyCleanup();
    startPaymentsJob();
    logger.info(`Payments: ${paymentsMode}`);
    if (!isMediaConfigured) {
      logger.warn('S3 is not configured (AWS_REGION, S3_BUCKET); media uploads are disabled');
    }
  });
  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error');
    void shutdown('SERVER_ERROR', 1);
  });
}

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  stopKeepAlive();
  stopMediaCleanup();
  stopStoryCleanup();
  stopNearbyCleanup();
  stopPaymentsJob();
  closeRealtime();
  setTimeout(() => process.exit(1), 10_000).unref();

  try {
    const httpServer = server;
    if (httpServer?.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await disconnectDatabase();
    await disconnectRedis();
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

start().catch(async (err) => {
  logger.fatal({ err }, 'Failed to start server');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
