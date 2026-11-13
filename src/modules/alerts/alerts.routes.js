import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { idParams, objectId } from '../../utils/schemas.js';
import * as s from './route-alerts.service.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 hour)');
const days = z.array(z.number().int().min(0).max(6)).min(1).max(7);
const createSchema = z.object({ routeId: objectId, fromStopId: objectId, days, startTime: time, endTime: time });
const updateSchema = z.object({ active: z.boolean().optional(), days: days.optional(), startTime: time.optional(), endTime: time.optional() });

const router = Router();
router.use(authenticate, requireRole('passenger', 'driver'));
router.get('/', asyncHandler(async (req, res) => res.json({ alerts: await s.listAlerts(req.user._id) })));
router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ alert: await s.createAlert(req.user, req.body) });
}));
router.patch('/:id', validate(idParams, 'params'), validate(updateSchema), asyncHandler(async (req, res) => {
  res.json({ alert: await s.updateAlert(req.user._id, req.params.id, req.body) });
}));
router.delete('/:id', validate(idParams, 'params'), asyncHandler(async (req, res) => {
  await s.deleteAlert(req.user._id, req.params.id);
  res.json({ ok: true });
}));

export default router;
