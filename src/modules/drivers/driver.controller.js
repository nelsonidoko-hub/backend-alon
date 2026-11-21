import { asyncHandler } from '../../utils/asyncHandler.js';
import { Booking } from '../bookings/booking.model.js';
import { startOfDayLagos } from '../../utils/time.js';
import { getRouteGeometry } from '../routes/routes.service.js';
import * as service from './driver.service.js';

export const apply = asyncHandler(async (req, res) => {
  res.status(201).json({ driver: await service.applyAsDriver(req.user, req.body) });
});

export const status = asyncHandler(async (req, res) => {
  res.json({ driver: await service.getDriverStatus(req.user) });
});

async function totals(driverId, since) {
  const [row] = await Booking.aggregate([
    { $match: { driverId, status: 'completed', completedAt: { $gte: since } } },
    { $group: { _id: null, total: { $sum: '$fare' }, trips: { $sum: 1 }, seats: { $sum: '$seats' } } },
  ]);
  return { total: row?.total || 0, trips: row?.trips || 0, seats: row?.seats || 0 };
}

export const earnings = asyncHandler(async (req, res) => {
  const today = startOfDayLagos();
  const week = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const [t, w] = await Promise.all([totals(req.driver._id, today), totals(req.driver._id, week)]);
  res.json({ today: t, last7Days: w });
});

export const adminList = asyncHandler(async (req, res) => {
  res.json({ drivers: await service.listDrivers(req.query.status) });
});
export const adminApprove = asyncHandler(async (req, res) => {
  res.json({ driver: await service.approveDriver(req.params.id, req.user) });
});
export const adminReject = asyncHandler(async (req, res) => {
  res.json({ driver: await service.rejectDriver(req.params.id, req.user, req.body.reason) });
});
export const adminSuspend = asyncHandler(async (req, res) => {
  res.json({ driver: await service.suspendDriver(req.params.id, req.user) });
});

/** The driver's latest finished trips, so they can rate or report a rider. */
export const recentTrips = asyncHandler(async (req, res) => {
  const rows = await Booking.find({ driverUserId: req.user._id, status: { $in: ['completed', 'no_show'] } })
    .sort('-updatedAt')
    .limit(15)
    .populate('passengerId', 'name ratingAvg ratingCount')
    .lean();
  const routes = new Map();
  const out = [];
  for (const b of rows) {
    const key = String(b.routeId);
    if (!routes.has(key)) routes.set(key, await getRouteGeometry(b.routeId, { activeOnly: false }).catch(() => null));
    const names = new Map((routes.get(key)?.stops || []).map((s) => [s.stopId, s.name]));
    out.push({
      id: String(b._id),
      status: b.status,
      completedAt: b.completedAt || b.updatedAt,
      fare: b.fare,
      from: names.get(String(b.fromStopId)),
      to: names.get(String(b.toStopId)),
      riderRated: Boolean(b.riderRated),
      passenger: { name: b.passengerId?.name?.split(' ')[0] || 'Rider', ratingAvg: b.passengerId?.ratingAvg || 0, ratingCount: b.passengerId?.ratingCount || 0 },
    });
  }
  res.json({ trips: out });
});

export const adminClearCancelLock = asyncHandler(async (req, res) => {
  res.json(await service.clearCancelLock(req.params.id));
});
