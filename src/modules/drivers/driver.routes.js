import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../utils/schemas.js';
import { requireApprovedDriver } from './driver.middleware.js';
import { applySchema, rejectSchema, driverListQuerySchema } from './driver.schema.js';
import sessionRoutes from '../sessions/session.routes.js';
import { driverBookingRouter } from '../bookings/booking.routes.js';
import * as c from './driver.controller.js';

const router = Router();
router.use(authenticate, requireRole('driver'));
router.post('/apply', validate(applySchema), c.apply);
router.get('/status', c.status);
router.use(requireApprovedDriver);
router.get('/earnings', c.earnings);
router.get('/trips/recent', c.recentTrips);
router.use('/sessions', sessionRoutes);
router.use('/bookings', driverBookingRouter);

export default router;

export const adminDriversRouter = Router();
adminDriversRouter.get('/', validate(driverListQuerySchema, 'query'), c.adminList);
adminDriversRouter.post('/:id/approve', validate(idParams, 'params'), c.adminApprove);
adminDriversRouter.post('/:id/reject', validate(idParams, 'params'), validate(rejectSchema), c.adminReject);
adminDriversRouter.post('/:id/unlock', validate(idParams, 'params'), c.adminClearCancelLock);
adminDriversRouter.post('/:id/suspend', validate(idParams, 'params'), c.adminSuspend);
