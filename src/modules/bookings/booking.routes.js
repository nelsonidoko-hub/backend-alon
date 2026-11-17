import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../utils/schemas.js';
import { ratingSchema } from '../ratings/rating.schema.js';
import {
  createBookingSchema,
  cancelSchema,
  pickupSchema,
  completeSchema,
  historyQuerySchema,
  tokenParams,
} from './booking.schema.js';
import * as c from './booking.controller.js';

export const passengerRouter = Router();
passengerRouter.use(authenticate, requireRole('passenger'));
passengerRouter.post('/', validate(createBookingSchema), c.create);
passengerRouter.get('/active', c.active);
passengerRouter.get('/', validate(historyQuerySchema, 'query'), c.history);
passengerRouter.post('/:id/cancel', validate(idParams, 'params'), validate(cancelSchema), c.cancel);
passengerRouter.post('/:id/here', validate(idParams, 'params'), c.here);
passengerRouter.get('/:id/share-link', validate(idParams, 'params'), c.shareLink);
passengerRouter.post('/:id/rating', validate(idParams, 'params'), validate(ratingSchema), c.rate);

export const driverBookingRouter = Router();
driverBookingRouter.post('/:id/pickup', validate(idParams, 'params'), validate(pickupSchema), c.driverPickup);
driverBookingRouter.post('/:id/complete', validate(idParams, 'params'), validate(completeSchema), c.driverComplete);
driverBookingRouter.post('/:id/rate-rider', validate(idParams, 'params'), validate(ratingSchema), c.driverRateRider);
driverBookingRouter.post('/:id/no-show', validate(idParams, 'params'), c.driverNoShow);

export const shareRouter = Router();
shareRouter.get('/:token', validate(tokenParams, 'params'), c.sharedTrip);
