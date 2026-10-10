import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { refreshPlans } from '../subscriptions/plans';
import { runPaymentsJob } from './payments.service';

const INTERVAL_MS = 5 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | undefined;
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    await refreshPlans();
    await runPaymentsJob();
  } catch (err) {
    logger.warn({ err }, 'Payments job failed');
  } finally {
    running = false;
  }
}

export function startPaymentsJob() {
  if (env.NODE_ENV === 'test') return;
  stopPaymentsJob();
  intervalTimer = setInterval(() => void run(), INTERVAL_MS);
  intervalTimer.unref();
  void run();
}

export function stopPaymentsJob() {
  clearInterval(intervalTimer);
  intervalTimer = undefined;
}
