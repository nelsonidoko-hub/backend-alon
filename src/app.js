import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import { env, clientOrigins } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import routes from './routes.js';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: clientOrigins }));
app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(mongoSanitize());
app.use(
  pinoHttp({
    logger,
    // Only log requests that went wrong, as one line. Normal 2xx/3xx traffic stays quiet.
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'silent'),
    serializers: {
      req: (req) => `${req.method} ${req.url}`,
      res: (res) => res.statusCode,
    },
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down' });
});

app.use('/api/v1', apiLimiter, routes);
app.use(notFound);
app.use(errorHandler);