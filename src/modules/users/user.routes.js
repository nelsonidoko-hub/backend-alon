import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { updateMeSchema, pushSubscriptionSchema, phoneRequestSchema, phoneConfirmSchema } from './user.schema.js';
import {
  getMe,
  updateMe,
  getPushKey,
  savePushSubscription,
  removePushSubscription,
  requestPhoneChange,
  confirmPhoneChange,
} from './user.controller.js';

const router = Router();
router.use(authenticate);
router.get('/', getMe);
router.patch('/', validate(updateMeSchema), updateMe);
router.post('/phone/request', validate(phoneRequestSchema), requestPhoneChange);
router.post('/phone/confirm', validate(phoneConfirmSchema), confirmPhoneChange);
router.get('/push-key', getPushKey);
router.post('/push-subscription', validate(pushSubscriptionSchema), savePushSubscription);
router.delete('/push-subscription', validate(pushSubscriptionSchema.pick({ endpoint: true })), removePushSubscription);

export default router;