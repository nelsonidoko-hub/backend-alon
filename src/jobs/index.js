import cron from 'node-cron';
import { logger, logOnce } from '../utils/logger.js';
import { markStaleSessions, closeAbandonedSessions } from '../modules/sessions/sessions.service.js';
import { expireStaleBookings } from '../modules/bookings/bookings.service.js';
import { reconcileSettlements, reconcileCashCommissions } from '../modules/wallet/wallet.service.js';
import {
  sendCommuteReminders,
  expireCommuteTrips,
  generateAllSchedules,
} from '../modules/commute/commute.service.js';

let running = false;

export function startJobs() {
  cron.schedule('*/30 * * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await markStaleSessions();
      await expireStaleBookings();
      await sendCommuteReminders();
      await expireCommuteTrips();
      await reconcileSettlements();
      await reconcileCashCommissions();
    } catch (err) {
      logOnce('error', `periodic:${err?.name}`, { err }, 'Periodic job failed (will retry every 30s, shown once a minute)');
    } finally {
      running = false;
    }
  });

  cron.schedule('0 3 * * *', async () => {
    try {
      await closeAbandonedSessions();
      await generateAllSchedules();
    } catch (err) {
      logger.error({ err }, 'Daily cleanup failed');
    }
  });

  logger.info('Background jobs started');
}
