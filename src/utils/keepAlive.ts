import { env } from '../config/env';
import { logger } from './logger';

let intervalTimer: NodeJS.Timeout | undefined;
let initialTimer: NodeJS.Timeout | undefined;

/**
 * Resolves the target URL for pinging the health endpoint.
 * Render automatically sets `RENDER_EXTERNAL_URL` in its environment.
 * Alternatively, `APP_URL` can be defined in .env.
 */
export function getKeepAliveUrl(): string {
  const baseUrl = env.RENDER_EXTERNAL_URL ?? env.APP_URL ?? `http://127.0.0.1:${env.PORT}`;
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}${env.API_PREFIX}/health`;
}

/**
 * Pings the health endpoint once.
 */
export async function pingHealth(): Promise<void> {
  const url = getKeepAliveUrl();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': 'Nexity-KeepAlive/1.0',
      },
    });

    if (res.ok) {
      logger.info({ status: res.status, url }, 'Keep-alive health ping successful');
    } else {
      logger.warn({ status: res.status, url }, 'Keep-alive health ping returned non-200 status');
    }
  } catch (err) {
    logger.warn({ err, url }, 'Keep-alive health ping failed');
  }
}

/**
 * Starts the keep-alive background worker that periodically pings the health endpoint.
 * Default interval is every 10 minutes (600,000ms) to prevent Render from idling out.
 */
export function startKeepAlive(): void {
  if (!env.KEEP_ALIVE_ENABLED || env.NODE_ENV === 'test') {
    return;
  }

  stopKeepAlive();

  const url = getKeepAliveUrl();
  logger.info(
    { intervalMs: env.KEEP_ALIVE_INTERVAL_MS, url },
    'Starting keep-alive self-ping service',
  );

  // Ping after 30 seconds to verify initial connectivity once server is up
  initialTimer = setTimeout(() => {
    void pingHealth();
  }, 30_000);
  initialTimer.unref();

  // Periodic interval ping
  intervalTimer = setInterval(() => {
    void pingHealth();
  }, env.KEEP_ALIVE_INTERVAL_MS);
  intervalTimer.unref();
}

/**
 * Stops the keep-alive interval (e.g., during graceful shutdown).
 */
export function stopKeepAlive(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = undefined;
  }

  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = undefined;
    logger.info('Keep-alive self-ping service stopped');
  }
}
