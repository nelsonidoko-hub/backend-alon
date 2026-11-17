import http from 'node:http';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { logger } from './utils/logger.js';
import { app } from './app.js';
import { initIo } from './realtime/io.js';
import { registerSocketHandlers } from './realtime/socket.js';
import { startJobs } from './jobs/index.js';

const server = http.createServer(app);
const io = initIo(server);
registerSocketHandlers(io);

async function start() {
  await connectDb();
  server.listen(env.PORT, () => logger.info(`FoloRide API running on port ${env.PORT}`));
  if (env.JOBS_ENABLED === 'true') startJobs();
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  io.close();
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));

start().catch((err) => {
  logger.error({ err }, 'Failed to start');
  process.exit(1);
});
