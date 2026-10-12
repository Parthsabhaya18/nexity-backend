import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { purgeExpiredNearby } from './nearby.service';

const INTERVAL_MS = 10 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | undefined;
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    await purgeExpiredNearby();
  } catch (err) {
    logger.warn({ err }, 'Nearby cleanup failed');
  } finally {
    running = false;
  }
}

export function startNearbyCleanup() {
  if (env.NODE_ENV === 'test') return;
  stopNearbyCleanup();
  intervalTimer = setInterval(() => void run(), INTERVAL_MS);
  intervalTimer.unref();
}

export function stopNearbyCleanup() {
  clearInterval(intervalTimer);
  intervalTimer = undefined;
}
