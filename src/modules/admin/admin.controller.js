import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { pageParams } from '../../utils/pagination.js';
import { startOfDayLagos } from '../../utils/time.js';
import { User } from '../users/user.model.js';
import { Driver } from '../drivers/driver.model.js';
import { DriverSession } from '../sessions/session.model.js';
import { Booking } from '../bookings/booking.model.js';
import { getLivePosition } from '../sessions/sessions.live.js';
import { endActiveSession } from '../sessions/sessions.service.js';
import { adminCancel } from '../bookings/bookings.service.js';
import { getRouteGeometry } from '../routes/routes.service.js';
import { project, haversine } from '../../utils/geo.js';
import { CAB_FRESH_MS, OFF_ROUTE_METERS } from '../../config/constants.js';

export const liveSessions = asyncHandler(async (_req, res) => {
  const sessions = await DriverSession.find({ active: true, online: true })
    .populate({ path: 'driverId', select: 'userId', populate: { path: 'userId', select: 'name phone' } })
    .populate('vehicleId', 'plate')
    .populate('routeId', 'name')
    .lean();
  // For each cab: would riders see it? If not, say why, so a missing cab can be explained.
  const rows = [];
  for (const s of sessions) {
    const location = getLivePosition(s);
    const age = s.lastSeen ? Math.round((Date.now() - new Date(s.lastSeen).getTime()) / 1000) : null;
    let distFromRoute = null;
    let why = '';
    let nearestStop = null;
    if (age == null || age * 1000 > CAB_FRESH_MS) why = `The phone has not reported for ${age == null ? 'a long time' : `${age} seconds`}. Keep the driver app open with the screen on.`;
    else if (!location) why = 'No location yet. Check that location is allowed for the driver app.';
    else {
      try {
        const g = await getRouteGeometry(s.routeId?._id || s.routeId, { activeOnly: false });
        distFromRoute = Math.round(project(g.path, location).distFrom);
        // The closest stop of this route, with its coordinates, so a wrongly placed stop can be told apart from a wrong GPS fix.
        const near = g.stops.map((st) => ({ st, d: haversine(location, st.location) })).sort((a, b) => a.d - b.d)[0];
        if (near) nearestStop = { name: near.st.name, meters: Math.round(near.d), lat: near.st.location.lat, lng: near.st.location.lng };
        if (OFF_ROUTE_METERS > 0 && distFromRoute > OFF_ROUTE_METERS) why = `The cab is ${distFromRoute} m from its route (limit ${OFF_ROUTE_METERS} m). Drive near the route, or raise OFF_ROUTE_METERS on Render.`;
      } catch { why = ''; }
    }
    rows.push({ s, location, age, distFromRoute, nearestStop, visible: !why, why });
  }
  res.json({
    sessions: rows.map(({ s, location, age, distFromRoute, nearestStop, visible, why }) => ({
      ageSeconds: age, distFromRoute, nearestStop, visible, why,
      id: String(s._id),
      route: s.routeId?.name,
      driver: s.driverId?.userId ? { name: s.driverId.userId.name, phone: s.driverId.userId.phone } : null,
      plate: s.vehicleId?.plate,
      seatsFree: s.seatsFree,
      seatsTotal: s.seatsTotal,
      location,
      lastSeen: s.lastSeen,
    })),
  });
});

export const searchBookings = asyncHandler(async (req, res) => {
  const { status, routeId, driverId, passengerId, from, to } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (routeId) filter.routeId = routeId;
  if (driverId) filter.driverId = driverId;
  if (passengerId) filter.passengerId = passengerId;
  if (from || to) {
    filter.requestedAt = {};
    if (from) filter.requestedAt.$gte = from;
    if (to) filter.requestedAt.$lte = to;
  }
  const p = pageParams(req.query);
  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort('-requestedAt')
      .skip(p.skip)
      .limit(p.limit)
      .select('-code -shareToken')
      .populate('passengerId', 'name phone')
      .populate('routeId', 'name')
      .lean(),
    Booking.countDocuments(filter),
  ]);
  res.json({ page: p.page, total, bookings });
});

export const cancelBooking = asyncHandler(async (req, res) => {
  res.json({ booking: await adminCancel(req.user, req.params.id, req.body.reason) });
});

export const listUsers = asyncHandler(async (req, res) => {
  const { role, q } = req.query;
  const filter = {};
  if (role) filter.role = role;
  if (q) {
    let digits = q.replace(/[^\d+]/g, '');
    if (digits.startsWith('0')) digits = `+234${digits.slice(1)}`;
    filter.phone = new RegExp(`^${digits.replace(/\+/g, '\\+')}`);
  }
  const p = pageParams(req.query);
  const [users, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(p.skip).limit(p.limit),
    User.countDocuments(filter),
  ]);
  res.json({ page: p.page, total, users });
});

export const setUserStatus = asyncHandler(async (req, res) => {
  if (String(req.user._id) === req.params.id) {
    throw new AppError(400, 'You cannot change your own status', 'INVALID_ACTION');
  }
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true });
  if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');
  if (user.status === 'blocked' && user.role === 'driver') {
    const driver = await Driver.findOne({ userId: user._id }).select('_id');
    if (driver) await endActiveSession(driver._id, 'Driver account blocked');
  }
  res.json({ user });
});

export const summary = asyncHandler(async (_req, res) => {
  const todayStart = startOfDayLagos();
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [byStatus, perDay, seatRow, approvedDrivers, passengers, ratingRow, onlineCabs] = await Promise.all([
    Booking.aggregate([
      { $match: { requestedAt: { $gte: weekStart } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: weekStart } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'Africa/Lagos' } },
          trips: { $sum: 1 },
          revenue: { $sum: '$fare' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    DriverSession.aggregate([
      { $match: { active: true, online: true } },
      { $group: { _id: null, total: { $sum: '$seatsTotal' }, free: { $sum: '$seatsFree' } } },
    ]),
    Driver.countDocuments({ status: 'approved' }),
    User.countDocuments({ role: 'passenger' }),
    Driver.aggregate([
      { $match: { ratingCount: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$ratingAvg' } } },
    ]),
    DriverSession.countDocuments({ active: true, online: true }),
  ]);

  const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  const total = byStatus.reduce((sum, r) => sum + r.n, 0);
  const lost = (counts.cancelled || 0) + (counts.no_show || 0) + (counts.expired || 0);
  const seats = seatRow[0];

  res.json({
    last7Days: {
      bookings: total,
      byStatus: counts,
      cancellationRate: total ? Math.round((lost / total) * 1000) / 10 : 0,
      completedPerDay: perDay.map((d) => ({ date: d._id, trips: d.trips, revenue: d.revenue })),
    },
    now: {
      onlineCabs,
      fillRate: seats?.total ? Math.round(((seats.total - seats.free) / seats.total) * 1000) / 10 : 0,
    },
    totals: {
      approvedDrivers,
      passengers,
      avgDriverRating: ratingRow[0] ? Math.round(ratingRow[0].avg * 100) / 100 : null,
    },
  });
});
