import rateLimit from 'express-rate-limit';

const limitError = (message) => ({ error: { code: 'RATE_LIMITED', message } });

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitError('Too many requests, slow down'),
});

export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitError('Too many code requests, try again later'),
});
