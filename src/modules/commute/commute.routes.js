import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { pageParams } from '../../utils/pagination.js';
import { idParams } from '../../utils/schemas.js';
import { requireApprovedDriver } from '../drivers/driver.middleware.js';
import * as s from './commute.service.js';
import {
  scheduleSchema,
  tripSchema,
  searchQuery,
  bookSchema,
  codeSchema,
  locationSchema,
  reasonSchema,
  adminTripQuery,
} from './commute.schema.js';

const router = Router();
router.use(authenticate);

const rider = requireRole('passenger', 'driver');
const driverOnly = [requireRole('driver'), requireApprovedDriver];
const params = validate(idParams, 'params');

// Riders (staff who want a seat)
router.get('/trips/search', rider, validate(searchQuery, 'query'), asyncHandler(async (req, res) => {
  res.json({ trips: await s.searchTrips(req.user, req.query) });
}));
router.post('/bookings', rider, validate(bookSchema), asyncHandler(async (req, res) => {
  const b = await s.bookTrip(req.user, req.body);
  res.status(201).json({ bookingId: String(b._id), code: b.code, status: b.status });
}));
router.get('/bookings', rider, asyncHandler(async (req, res) => {
  res.json(await s.myBookings(req.user));
}));
router.post('/bookings/:id/cancel', rider, params, asyncHandler(async (req, res) => {
  res.json({ booking: await s.cancelMyBooking(req.user, req.params.id) });
}));

// Drivers (staff with a car)
router.post('/schedules', ...driverOnly, validate(scheduleSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ schedules: await s.createSchedules(req.user, req.driver, req.body) });
}));
router.get('/schedules', ...driverOnly, asyncHandler(async (req, res) => {
  res.json({ schedules: await s.listSchedules(req.user) });
}));
router.delete('/schedules/:id', ...driverOnly, params, asyncHandler(async (req, res) => {
  res.json(await s.removeSchedule(req.user, req.params.id));
}));
router.post('/trips', ...driverOnly, validate(tripSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ trip: await s.createOneOffTrip(req.user, req.driver, req.body) });
}));
router.get('/driver/trips', ...driverOnly, asyncHandler(async (req, res) => {
  res.json({ trips: await s.listDriverTrips(req.user) });
}));
router.get('/trips/:id/bookings', ...driverOnly, params, asyncHandler(async (req, res) => {
  res.json({ bookings: await s.tripBookings(req.user, req.params.id) });
}));
router.post('/trips/:id/start', ...driverOnly, params, asyncHandler(async (req, res) => {
  res.json({ trip: await s.startTrip(req.user, req.params.id) });
}));
router.post('/trips/:id/complete', ...driverOnly, params, asyncHandler(async (req, res) => {
  res.json({ trip: await s.completeTrip(req.user, req.driver, req.params.id) });
}));
router.post('/trips/:id/cancel', ...driverOnly, params, validate(reasonSchema), asyncHandler(async (req, res) => {
  res.json({ trip: await s.cancelTrip(req.user, req.params.id, req.body.reason) });
}));
router.post('/trips/:id/location', ...driverOnly, params, validate(locationSchema), asyncHandler(async (req, res) => {
  await s.recordCommuteLocation({ userId: req.user._id, tripId: req.params.id, ...req.body });
  res.json({ ok: true });
}));
router.post('/bookings/:id/pickup', ...driverOnly, params, validate(codeSchema), asyncHandler(async (req, res) => {
  res.json({ booking: await s.pickupRider(req.user, req.params.id, req.body.code) });
}));
router.post('/bookings/:id/no-show', ...driverOnly, params, asyncHandler(async (req, res) => {
  res.json({ booking: await s.noShowRider(req.user, req.params.id) });
}));

export default router;

export const adminCommuteRouter = Router();
adminCommuteRouter.get('/trips', validate(adminTripQuery, 'query'), asyncHandler(async (req, res) => {
  const p = pageParams(req.query);
  res.json({ page: p.page, ...(await s.adminListTrips({ ...req.query, skip: p.skip, limit: p.limit })) });
}));
adminCommuteRouter.post('/trips/:id/cancel', params, validate(reasonSchema), asyncHandler(async (req, res) => {
  res.json({ trip: await s.adminCancelTrip(req.params.id, req.body.reason) });
}));
