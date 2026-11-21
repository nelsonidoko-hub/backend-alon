import { asyncHandler } from '../../utils/asyncHandler.js';
import { pageParams } from '../../utils/pagination.js';
import { createRating, rateRider } from '../ratings/ratings.service.js';
import * as service from './bookings.service.js';

export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ booking: await service.createBooking(req.user, req.body) });
});

export const active = asyncHandler(async (req, res) => {
  res.json({ booking: await service.getActiveBooking(req.user) });
});

export const history = asyncHandler(async (req, res) => {
  const p = pageParams(req.query);
  res.json({ page: p.page, bookings: await service.listHistory(req.user, p) });
});

export const cancel = asyncHandler(async (req, res) => {
  res.json({ booking: await service.cancelByPassenger(req.user, req.params.id, req.body.reason) });
});

export const here = asyncHandler(async (req, res) => {
  res.json({ booking: await service.markAtStop(req.user, req.params.id) });
});

export const shareLink = asyncHandler(async (req, res) => {
  res.json(await service.createShareLink(req.user, req.params.id));
});

export const rate = asyncHandler(async (req, res) => {
  res.status(201).json({ rating: await createRating(req.user, req.params.id, req.body) });
});

export const sharedTrip = asyncHandler(async (req, res) => {
  res.json({ trip: await service.getSharedTrip(req.params.token) });
});

export const driverRateRider = asyncHandler(async (req, res) => {
  res.status(201).json(await rateRider(req.user, req.params.id, req.body));
});

export const driverPickup = asyncHandler(async (req, res) => {
  res.json({ booking: await service.pickup(req.driver, req.params.id, req.body.code) });
});

export const driverComplete = asyncHandler(async (req, res) => {
  res.json({ booking: await service.complete(req.driver, req.params.id, req.body.paymentConfirmed) });
});

export const driverCancel = asyncHandler(async (req, res) => {
  res.json({ booking: await service.cancelByDriver(req.driver, req.params.id, req.body.reason) });
});

export const driverNoShow = asyncHandler(async (req, res) => {
  res.json({ booking: await service.noShow(req.driver, req.params.id) });
});
