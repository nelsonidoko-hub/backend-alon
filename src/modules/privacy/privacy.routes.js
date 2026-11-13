import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as s from './privacy.service.js';

const router = Router();
router.use(authenticate);

router.get('/export', asyncHandler(async (req, res) => {
  const data = await s.exportData(req.user);
  res.setHeader('Content-Disposition', 'attachment; filename="along-my-data.json"');
  res.json(data);
}));

// Request a login code first (POST /auth/request-otp), then send it here to confirm.
router.post('/delete', validate(z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') })), asyncHandler(async (req, res) => {
  res.json(await s.deleteAccount(req.user, req.body.code));
}));

export default router;
