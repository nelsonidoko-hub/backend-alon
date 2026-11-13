import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../modules/users/user.model.js';

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
  }
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new AppError(401, 'Invalid or expired token', 'INVALID_TOKEN');
  }
  const user = await User.findById(payload.sub);
  if (!user) throw new AppError(401, 'User not found', 'UNAUTHENTICATED');
  if (user.status === 'deleted') throw new AppError(401, 'This account was deleted', 'UNAUTHENTICATED');
  if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
  req.user = user;
  next();
});

// For public pages: no Authorization header means a visitor (req.user stays empty).
// A header that is present must still be valid, so an expired token gets a 401 and the app can refresh it.
export const optionalAuthenticate = (req, res, next) =>
  req.headers.authorization ? authenticate(req, res, next) : next();

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'You do not have access to this resource', 'FORBIDDEN'));
    }
    next();
  };