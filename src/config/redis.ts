import { createClient, type RedisClientType } from 'redis';

import { env } from './env';
import { logger } from '../utils/logger';

let client: RedisClientType | null = null;

/** The shared client, created as soon as `REDIS_URL` is set. Commands queue until `connectRedis`. */
export function redisClient() {
  if (!env.REDIS_URL) return null;
  if (!client) {
    const next = createClient({ url: env.REDIS_URL });
    next.on('error', (err) => logger.error({ err }, 'Redis connection error'));
    client = next;
  }
  return client;
}

export async function connectRedis() {
  const current = redisClient();
  if (!current || current.isOpen) return current;
  await current.connect();
  logger.info('Redis connected');
  return current;
}

export async function disconnectRedis() {
  if (client?.isOpen) await client.quit();
  client = null;
}
