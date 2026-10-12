import { env, isMediaConfigured } from '../../config/env';
import { logger } from '../../utils/logger';
import { purgeAbandonedUploads } from './media.service';

const INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

let intervalTimer: NodeJS.Timeout | undefined;
let initialTimer: NodeJS.Timeout | undefined;

async function run() {
  try {
    const purged = await purgeAbandonedUploads();
    if (purged) logger.info({ purged }, 'Purged abandoned media uploads');
  } catch (err) {
    logger.warn({ err }, 'Media cleanup failed');
  }
}

export function startMediaCleanup() {
  if (!isMediaConfigured || env.NODE_ENV === 'test') return;
  stopMediaCleanup();
  initialTimer = setTimeout(() => void run(), FIRST_RUN_DELAY_MS);
  initialTimer.unref();
  intervalTimer = setInterval(() => void run(), INTERVAL_MS);
  intervalTimer.unref();
}

export function stopMediaCleanup() {
  clearTimeout(initialTimer);
  clearInterval(intervalTimer);
  initialTimer = undefined;
  intervalTimer = undefined;
}
