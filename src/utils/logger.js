import pino from 'pino';
import { env } from '../config/env.js';

// Errors are printed as one short line (name and message), not the whole stack and driver internals.
// Set LOG_LEVEL=debug in .env when you need the full detail.
const shortErr = (err) => ({ type: err?.name, message: String(err?.message || err).split('\n')[0].slice(0, 200), code: err?.code });

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: { err: process.env.LOG_LEVEL === 'debug' ? pino.stdSerializers.err : shortErr },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname', translateTime: 'HH:MM:ss' } }
      : undefined,
});

// Repeats of the same failure (for example the database being unreachable) are printed at most once a minute.
const lastSeen = new Map();
export function logOnce(level, key, obj, msg) {
  const now = Date.now();
  if (now - (lastSeen.get(key) || 0) < 60_000) return;
  lastSeen.set(key, now);
  logger[level](obj, msg);
}