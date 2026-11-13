import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { pageParams } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';
import { objectId } from '../../utils/schemas.js';
import { AuditLog } from './audit.model.js';
import { redact } from './audit.redact.js';

/** Records every successful change an admin makes (anything that is not a read). */
export function auditAdmin(req, res, next) {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    AuditLog.create({
      actorId: req.user._id,
      actorName: req.user.name,
      actorPhone: req.user.phone,
      method: req.method,
      route: `${req.baseUrl}${req.route?.path || ''}`,
      url: req.originalUrl.split('?')[0],
      params: req.params,
      body: redact(req.body),
      status: res.statusCode,
      ip: req.ip,
    }).catch((err) => logger.error({ err }, 'Could not write audit log'));
  });
  next();
}

const query = z.object({
  actorId: objectId.optional(),
  q: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const auditRouter = Router();
auditRouter.get('/', validate(query, 'query'), asyncHandler(async (req, res) => {
  const { actorId, q, from, to } = req.query;
  const filter = {};
  if (actorId) filter.actorId = actorId;
  if (q) filter.route = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const p = pageParams(req.query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort('-createdAt').skip(p.skip).limit(p.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ page: p.page, total, items });
}));
