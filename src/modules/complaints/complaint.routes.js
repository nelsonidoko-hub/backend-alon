import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { idParams, objectId } from '../../utils/schemas.js';
import { Complaint } from './complaint.model.js';
import { Booking } from '../bookings/booking.model.js';
import { CommuteBooking } from '../commute/commute.models.js';

const createSchema = z.object({
  bookingId: objectId.optional(),
  commuteBookingId: objectId.optional(),
  type: z.enum(['safety', 'fare', 'driver_behaviour', 'rider_behaviour', 'harassment', 'no_show', 'cab_condition', 'other']).default('other'),
  message: z.string().trim().min(5).max(1000),
});
const listQuery = z.object({ status: z.enum(['open', 'resolved']).optional() });
const resolveSchema = z.object({ resolution: z.string().trim().min(2).max(500) });

export const complaintRouter = Router();
complaintRouter.use(authenticate, requireRole('passenger', 'driver'));
complaintRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { bookingId, commuteBookingId, type, message } = req.body;
    // Work out who the report is about: the other person on the trip.
    let aboutUserId;
    const mine = { $or: [{ passengerId: req.user._id }, { driverUserId: req.user._id }] };
    if (bookingId || commuteBookingId) {
      const b = bookingId
        ? await Booking.findOne({ _id: bookingId, ...mine }).select('passengerId driverUserId')
        : await CommuteBooking.findOne({ _id: commuteBookingId, ...mine }).select('passengerId driverUserId');
      if (!b) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
      aboutUserId = String(b.passengerId) === String(req.user._id) ? b.driverUserId : b.passengerId;
    }
    const complaint = await Complaint.create({ userId: req.user._id, bookingId, commuteBookingId, aboutUserId, type, message });
    res.status(201).json({ complaint });
  })
);

export const adminComplaintsRouter = Router();
adminComplaintsRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : {};
    res.json({ complaints: await Complaint.find(filter).sort('-createdAt').limit(200).populate('userId', 'name phone role').populate('aboutUserId', 'name phone role') });
  })
);
adminComplaintsRouter.patch(
  '/:id/resolve',
  validate(idParams, 'params'),
  validate(resolveSchema),
  asyncHandler(async (req, res) => {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'resolved', resolution: req.body.resolution, resolvedBy: req.user._id, resolvedAt: new Date() } },
      { new: true }
    );
    if (!complaint) throw new AppError(404, 'Complaint not found', 'NOT_FOUND');
    res.json({ complaint });
  })
);
