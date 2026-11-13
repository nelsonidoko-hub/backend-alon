import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { idParams, objectId } from '../../utils/schemas.js';
import { adminStopsRouter, adminRoutesRouter, adminFaresRouter } from '../routes/routes.routes.js';
import { adminDriversRouter } from '../drivers/driver.routes.js';
import { adminSosRouter } from '../sos/sos.routes.js';
import { adminComplaintsRouter } from '../complaints/complaint.routes.js';
import { adminOrganizationRouter } from '../organizations/organization.routes.js';
import { adminCommuteRouter } from '../commute/commute.routes.js';
import { adminWalletRouter } from '../wallet/wallet.routes.js';
import { auditAdmin, auditRouter } from '../audit/audit.routes.js';
import { adminNotificationRouter } from '../notifications/notification.routes.js';
import * as c from './admin.controller.js';

const bookingQuery = z.object({
  status: z.enum(['confirmed', 'arriving', 'picked_up', 'completed', 'cancelled', 'no_show', 'expired']).optional(),
  routeId: objectId.optional(),
  driverId: objectId.optional(),
  passengerId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const cancelSchema = z.object({ reason: z.string().trim().max(200).optional() });
const userQuery = z.object({
  role: z.enum(['passenger', 'driver', 'admin']).optional(),
  q: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const statusSchema = z.object({ status: z.enum(['active', 'blocked']) });

const router = Router();
router.use(authenticate, requireRole('admin'), auditAdmin);
router.use('/audit', auditRouter);
router.use('/stops', adminStopsRouter);
router.use('/routes', adminRoutesRouter);
router.use('/fares', adminFaresRouter);
router.use('/drivers', adminDriversRouter);
router.use('/sos', adminSosRouter);
router.use('/complaints', adminComplaintsRouter);
router.use('/organizations', adminOrganizationRouter);
router.use('/commute', adminCommuteRouter);
router.use('/wallet', adminWalletRouter);
router.use('/notifications', adminNotificationRouter);
router.get('/sessions/live', c.liveSessions);
router.get('/bookings', validate(bookingQuery, 'query'), c.searchBookings);
router.post('/bookings/:id/cancel', validate(idParams, 'params'), validate(cancelSchema), c.cancelBooking);
router.get('/users', validate(userQuery, 'query'), c.listUsers);
router.patch('/users/:id/status', validate(idParams, 'params'), validate(statusSchema), c.setUserStatus);
router.get('/reports/summary', c.summary);

export default router;
