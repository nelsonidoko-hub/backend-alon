import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { idParams, lat, lng } from '../../utils/schemas.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { User } from '../users/user.model.js';
import { Organization } from './organization.model.js';

const newCode = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();

const joinSchema = z.object({
  code: z.string().trim().min(4).max(12),
  staffId: z.string().trim().min(1).max(40),
});
const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  lat,
  lng,
  address: z.string().trim().max(200).optional(),
  autoVerify: z.boolean().optional(),
  maxPricePerSeat: z.number().int().min(0).max(100000).optional(),
});
const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional(),
  regenerateCode: z.boolean().optional(),
});
const verifySchema = z.object({ verified: z.boolean() });

const publicView = (o) => ({ id: String(o._id), name: o.name, address: o.address, location: o.location });

export const organizationRouter = Router();
organizationRouter.use(authenticate);

organizationRouter.post(
  '/join',
  validate(joinSchema),
  asyncHandler(async (req, res) => {
    const org = await Organization.findOne({ joinCode: req.body.code.toUpperCase(), active: true });
    if (!org) throw new AppError(404, 'Invalid organisation code', 'ORG_NOT_FOUND');
    req.user.organization = { orgId: org._id, name: org.name, staffId: req.body.staffId, verified: org.autoVerify };
    await req.user.save();
    res.json({ user: req.user, organization: publicView(org) });
  })
);

organizationRouter.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const orgId = req.user.organization?.orgId;
    const org = orgId ? await Organization.findById(orgId) : null;
    res.json({
      organization: org ? { ...publicView(org), verified: Boolean(req.user.organization.verified) } : null,
    });
  })
);

export const adminOrganizationRouter = Router();
adminOrganizationRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ organizations: await Organization.find().sort('name') });
  })
);
adminOrganizationRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, lat: la, lng: lo, address, autoVerify, maxPricePerSeat } = req.body;
    const org = await Organization.create({
      name,
      address,
      autoVerify,
      maxPricePerSeat,
      location: { lat: la, lng: lo },
      joinCode: newCode(),
    });
    res.status(201).json({ organization: org });
  })
);
adminOrganizationRouter.patch(
  '/:id',
  validate(idParams, 'params'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const { name, lat: la, lng: lo, address, autoVerify, maxPricePerSeat, active, regenerateCode } = req.body;
    const patch = {};
    for (const [k, v] of Object.entries({ name, address, autoVerify, maxPricePerSeat, active })) {
      if (v !== undefined) patch[k] = v;
    }
    if (la !== undefined && lo !== undefined) patch.location = { lat: la, lng: lo };
    if (regenerateCode) patch.joinCode = newCode();
    const org = await Organization.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    if (!org) throw new AppError(404, 'Organisation not found', 'NOT_FOUND');
    res.json({ organization: org });
  })
);
adminOrganizationRouter.post(
  '/users/:id/verify',
  validate(idParams, 'params'),
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user?.organization?.orgId) throw new AppError(400, 'This user has not joined an organisation', 'NO_ORG');
    user.organization.verified = req.body.verified;
    await user.save();
    notifyUser(user._id, 'org:status', { verified: req.body.verified }, {
      title: 'FoloRide',
      body: req.body.verified
        ? `Your ${user.organization.name} membership is verified. You can use staff carpooling.`
        : `Your ${user.organization.name} membership was not verified.`,
      sms: true,
    });
    res.json({ user });
  })
);
