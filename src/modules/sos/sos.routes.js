import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { idParams, objectId, lat, lng } from '../../utils/schemas.js';
import * as service from './sos.service.js';

const sosSchema = z.object({
  bookingId: objectId.optional(),
  commuteBookingId: objectId.optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  note: z.string().trim().max(300).optional(),
});
const listQuery = z.object({ status: z.enum(['open', 'handled']).optional() });

export const sosRouter = Router();
sosRouter.use(authenticate, requireRole('passenger', 'driver'));
sosRouter.post(
  '/',
  validate(sosSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createSos(req.user, req.body));
  })
);

export const adminSosRouter = Router();
adminSosRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ alerts: await service.listAlerts(req.query.status) });
  })
);
adminSosRouter.patch(
  '/:id',
  validate(idParams, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ alert: await service.handleAlert(req.params.id, req.user) });
  })
);
