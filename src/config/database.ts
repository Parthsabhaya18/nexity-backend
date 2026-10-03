import { setTimeout as sleep } from 'node:timers/promises';

import mongoose from 'mongoose';

import { logger } from '../utils/logger';
import { env } from './env';

const MAX_CONNECT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;

mongoose.set('strictQuery', true);

let listenersAttached = false;
let hasConnected = false;

/** Hides credentials so connection strings are safe to log. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@/]+@/, '//***:***@');
}

function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  // Failures during the initial connect are reported by connectDatabase's retry loop instead.
  const { connection } = mongoose;
  connection.on('connected', () => {
    hasConnected = true;
    logger.info({ db: connection.name, host: connection.host }, 'MongoDB connected');
  });
  connection.on('disconnected', () => {
    if (hasConnected) logger.warn('MongoDB disconnected');
  });
  connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  connection.on('error', (err) => {
    if (hasConnected) logger.error({ err }, 'MongoDB connection error');
  });
}

export async function connectDatabase(uri: string | undefined = env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  attachConnectionListeners();

  for (let attempt = 1; ; attempt++) {
    try {
      return await mongoose.connect(uri, {
        dbName: env.MONGODB_DB_NAME,
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        appName: 'nexity-backend',
      });
    } catch (err) {
      if (attempt >= MAX_CONNECT_ATTEMPTS) {
        throw new Error(
          `Could not connect to MongoDB at ${redactMongoUri(uri)} after ${attempt} attempts: ${(err as Error).message}`,
          { cause: err },
        );
      }
      logger.warn(
        { attempt, maxAttempts: MAX_CONNECT_ATTEMPTS, reason: (err as Error).message },
        `MongoDB connection failed, retrying in ${RETRY_DELAY_MS / 1000}s`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.disconnected) {
    hasConnected = false;
    await mongoose.disconnect();
    logger.info('MongoDB connection closed');
  }
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
