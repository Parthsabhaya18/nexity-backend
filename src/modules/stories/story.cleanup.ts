import { env, isMediaConfigured } from '../../config/env';
import { logger } from '../../utils/logger';
import { purgeExpiredStories } from './story.service';

/** Expired stories are already hidden by every query; this frees their S3 storage soon after. */
const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;

let intervalTimer: NodeJS.Timeout | undefined;
let initialTimer: NodeJS.Timeout | undefined;
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    const { stories, orphans } = await purgeExpiredStories();
    if (stories || orphans) logger.info({ stories, orphans }, 'Deleted expired stories from S3');
  } catch (err) {
    logger.warn({ err }, 'Story cleanup failed');
  } finally {
    running = false;
  }
}

export function startStoryCleanup() {
  if (!isMediaConfigured || env.NODE_ENV === 'test') return;
  stopStoryCleanup();
  initialTimer = setTimeout(() => void run(), FIRST_RUN_DELAY_MS);
  initialTimer.unref();
  intervalTimer = setInterval(() => void run(), INTERVAL_MS);
  intervalTimer.unref();
}

export function stopStoryCleanup() {
  clearTimeout(initialTimer);
  clearInterval(intervalTimer);
  initialTimer = undefined;
  intervalTimer = undefined;
}
