import { AppError } from '../utils/AppError.js';

export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(new AppError(400, 'Invalid request data', 'VALIDATION_ERROR', details));
    }
    if (source !== 'params') req[source] = result.data;
    next();
  };
