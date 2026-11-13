import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export const notFound = (req, _res, next) =>
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'));

export function errorHandler(err, req, res, _next) {
  let status = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message;
  let details = err.details;

  if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with this value already exists';
    details = err.keyValue;
  } else if (err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = 'Invalid id';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Malformed JSON body';
  }

  if (status >= 500) {
    logger.error({ err, path: req.originalUrl }, 'Unhandled error');
    code = 'INTERNAL_ERROR';
    message = 'Something went wrong';
    details = undefined;
  }

  res.status(status).json({ error: { code, message, ...(details && { details }) } });
}
