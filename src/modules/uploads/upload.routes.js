import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { storageEnabled, presignUpload } from './storage.service.js';

const MAX_BYTES = 5 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const schema = z
  .object({
    purpose: z.enum(['profile', 'licence', 'id', 'vehicle_papers']),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    size: z.number().int().min(1).max(MAX_BYTES),
  })
  .refine((v) => v.purpose !== 'profile' || v.contentType !== 'application/pdf', {
    message: 'Profile photo must be an image',
  });

const router = Router();
router.use(authenticate, requireRole('driver'));
router.post(
  '/presign',
  validate(schema),
  asyncHandler(async (req, res) => {
    if (!storageEnabled) throw new AppError(503, 'File uploads are not configured', 'UPLOADS_DISABLED');
    const { purpose, contentType, size } = req.body;
    const folder = purpose === 'profile' ? 'profiles' : 'docs';
    const key = `${folder}/${req.user._id}/${purpose}-${crypto.randomBytes(8).toString('hex')}.${EXT[contentType]}`;
    const uploadUrl = await presignUpload({ key, contentType, size });
    res.json({ uploadUrl, key, method: 'PUT', headers: { 'Content-Type': contentType }, expiresIn: 300 });
  })
);

export default router;
