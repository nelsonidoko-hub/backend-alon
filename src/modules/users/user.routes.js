import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { updateMeSchema, pushSubscriptionSchema } from './user.schema.js';
import {
  getMe,
  updateMe,
  getPushKey,
  savePushSubscription,
  removePushSubscription,
} from './user.controller.js';

const router = Router();
router.use(authenticate);
router.get('/', getMe);
router.patch('/', validate(updateMeSchema), updateMe);
router.get('/push-key', getPushKey);
router.post('/push-subscription', validate(pushSubscriptionSchema), savePushSubscription);
router.delete('/push-subscription', validate(pushSubscriptionSchema.pick({ endpoint: true })), removePushSubscription);

export default router;
