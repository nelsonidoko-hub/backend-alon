import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { otpLimiter } from '../../middleware/rateLimit.js';
import { requestOtpSchema, verifyOtpSchema, refreshSchema, socialSchema, socialPhoneSchema } from './auth.schema.js';
import { requestOtp, verifyOtp, refresh, logout, social, socialPhone } from './auth.controller.js';

const router = Router();
router.post('/request-otp', otpLimiter, validate(requestOtpSchema), requestOtp);
router.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), verifyOtp);
router.post('/social', otpLimiter, validate(socialSchema), social);
router.post('/social/phone', otpLimiter, validate(socialPhoneSchema), socialPhone);
router.post('/refresh', validate(refreshSchema), refresh);
router.post('/logout', validate(refreshSchema), logout);

export default router;