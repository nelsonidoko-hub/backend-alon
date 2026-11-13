import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { pageParams } from '../../utils/pagination.js';
import { objectId } from '../../utils/schemas.js';
import { User } from '../users/user.model.js';
import { Notification } from './notification.model.js';
import { notifyUser, presentNotification } from './notifications.service.js';

const listQuery = z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).optional() });
const readSchema = z.object({ ids: z.array(objectId).max(100).optional() });

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const p = pageParams(req.query);
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user._id }).sort('-createdAt').skip(p.skip).limit(p.limit).lean(),
    Notification.countDocuments({ userId: req.user._id, readAt: null }),
  ]);
  res.json({ page: p.page, unread, items: items.map(presentNotification) });
}));

notificationRouter.post('/read', validate(readSchema), asyncHandler(async (req, res) => {
  const filter = { userId: req.user._id, readAt: null };
  if (req.body.ids?.length) filter._id = { $in: req.body.ids };
  const r = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  res.json({ marked: r.modifiedCount });
}));

const broadcastSchema = z.object({
  audience: z.enum(['all', 'passengers', 'drivers']),
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(2).max(300),
  url: z.string().trim().max(100).optional(),
});

export const adminNotificationRouter = Router();
adminNotificationRouter.post('/broadcast', validate(broadcastSchema), asyncHandler(async (req, res) => {
  const { audience, title, body, url } = req.body;
  const roles = audience === 'all' ? ['passenger', 'driver'] : [audience === 'drivers' ? 'driver' : 'passenger'];
  const users = await User.find({ status: 'active', role: { $in: roles } }).select('_id').limit(5000).lean();
  for (let i = 0; i < users.length; i += 50) {
    await Promise.all(
      users.slice(i, i + 50).map((u) => notifyUser(u._id, 'announcement', {}, { type: 'announcement', title, body, url }))
    );
  }
  res.json({ sent: users.length });
}));
