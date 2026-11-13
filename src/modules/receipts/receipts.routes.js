import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { idParams } from '../../utils/schemas.js';
import * as s from './receipts.service.js';

const statementQuery = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((v) => v.to >= v.from && v.to - v.from <= 366 * 86400000, {
  message: 'Choose a range of up to one year',
});

const router = Router();
router.use(authenticate, requireRole('passenger', 'driver'));
router.get('/statement', requireRole('driver'), validate(statementQuery, 'query'), asyncHandler(async (req, res) => {
  res.json(await s.driverStatement(req.user, req.query.from, req.query.to));
}));
router.get('/ride/:id', validate(idParams, 'params'), asyncHandler(async (req, res) => res.json({ receipt: await s.rideReceipt(req.user, req.params.id) })));
router.get('/commute/:id', validate(idParams, 'params'), asyncHandler(async (req, res) => res.json({ receipt: await s.commuteReceipt(req.user, req.params.id) })));

export default router;
