import { asyncHandler } from '../../utils/asyncHandler.js';
import { recordLocation } from './sessions.live.js';
import * as service from './sessions.service.js';

export const start = asyncHandler(async (req, res) => {
  res.status(201).json({ session: await service.startSession(req.driver, req.body) });
});

export const current = asyncHandler(async (req, res) => {
  res.json({ session: await service.getCurrentSession(req.driver) });
});

export const seats = asyncHandler(async (req, res) => {
  res.json({ session: await service.setSeats(req.driver, req.params.id, req.body) });
});

export const location = asyncHandler(async (req, res) => {
  const { lat, lng, heading, speed } = req.body;
  await recordLocation({
    sessionId: req.params.id,
    driverId: req.driver._id,
    lat,
    lng,
    heading: heading ?? undefined,
    speed: speed ?? undefined,
  });
  res.json({ ok: true });
});

export const end = asyncHandler(async (req, res) => {
  res.json(await service.endSession(req.driver, req.params.id));
});

export const bookings = asyncHandler(async (req, res) => {
  res.json({ bookings: await service.listSessionBookings(req.driver, req.params.id) });
});

export const waiting = asyncHandler(async (req, res) => {
  const [waiting, next] = await Promise.all([service.waitingByStop(req.driver, req.params.id), service.nextStops(req.driver, req.params.id)]);
  res.json({ waiting, next });
});