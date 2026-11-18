import { vehicleKind } from '../drivers/vehicle.model.js';
import { DriverSession } from './session.model.js';
import { Booking } from '../bookings/booking.model.js';
import { seatTier, tierFare } from './pricing.js';
import { getRouteGeometry, getFare } from '../routes/routes.service.js';
import { announceSeats, forgetSession, getLivePosition, markOffline } from './sessions.live.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { emitToRoute, joinUserToRoom, closeRoom } from '../../realtime/io.js';
import { fileUrl } from '../uploads/storage.service.js';
import { settleBookingDoc } from '../wallet/wallet.service.js';
import { lookingByStop } from '../demand/demand.service.js'; // FEATURE: DRIVER DEMAND ALERTS
import { AppError } from '../../utils/AppError.js';
import { project, etaSeconds } from '../../utils/geo.js';
import { CAB_FRESH_MS, CAB_STALE_MS, PASSED_METERS, OFF_ROUTE_METERS } from '../../config/constants.js';

async function closeSession(session, reason) {
  await DriverSession.updateOne(
    { _id: session._id },
    { $set: { active: false, online: false, endedAt: new Date() } }
  );
  const pending = await Booking.find({ sessionId: session._id, status: { $in: ['confirmed', 'arriving'] } })
    .select('passengerId')
    .lean();
  if (pending.length) {
    await Booking.updateMany(
      { _id: { $in: pending.map((b) => b._id) } },
      { $set: { status: 'cancelled', active: false, cancelledBy: 'system', cancelReason: reason, cancelledAt: new Date() } }
    );
    const held = await Booking.find({ _id: { $in: pending.map((b) => b._id) }, heldKobo: { $gt: 0 } });
    for (const h of held) await settleBookingDoc('ride', h);
    for (const b of pending) {
      notifyUser(
        b.passengerId,
        'booking:status',
        { bookingId: String(b._id), status: 'cancelled', reason },
        { title: 'Booking cancelled', body: `Your FoloRide booking was cancelled: ${reason}.`, sms: true }
      );
    }
  }
  emitToRoute(session.routeId, 'cab:offline', { sessionId: String(session._id) });
  forgetSession(session._id);
  closeRoom(`session:${session._id}`);
}

export async function endActiveSession(driverId, reason = 'The driver went offline') {
  const session = await DriverSession.findOne({ driverId, active: true });
  if (session) await closeSession(session, reason);
  return session;
}

export async function startSession(driver, { routeId, lat, lng, seats }) {
  await getRouteGeometry(routeId);
  const capacity = driver.vehicleId.seatCapacity;
  if (seats !== undefined && seats > capacity) {
    throw new AppError(400, `Your vehicle has ${capacity} passenger seat${capacity === 1 ? '' : 's'}, so you can offer at most ${capacity}.`, 'TOO_MANY_SEATS');
  }
  await endActiveSession(driver._id);
  const total = seats ?? capacity; // offering fewer seats than the vehicle has makes it a comfort ride
  const hasLocation = lat !== undefined && lng !== undefined;
  const session = await DriverSession.create({
    driverId: driver._id,
    vehicleId: driver.vehicleId._id,
    routeId,
    seatsTotal: total,
    seatsFree: total,
    seatsCapacity: capacity,
    lastSeen: new Date(),
    ...(hasLocation && { lastLocation: { type: 'Point', coordinates: [lng, lat] } }),
  });
  joinUserToRoom(driver.userId, `session:${session._id}`);
  return session;
}

export async function endSession(driver, sessionId) {
  const session = await DriverSession.findOne({ _id: sessionId, driverId: driver._id, active: true });
  if (!session) throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
  await closeSession(session, 'The driver went offline');
  return { message: 'You are offline' };
}

export async function getCurrentSession(driver) {
  const session = await DriverSession.findOne({ driverId: driver._id, active: true }).lean();
  if (!session) return null;
  const g = await getRouteGeometry(session.routeId, { activeOnly: false });
  return { ...session, routeName: g.route.name };
}

export async function setSeats(driver, sessionId, { seatsFree, delta }) {
  const session = await DriverSession.findOne({ _id: sessionId, driverId: driver._id, active: true });
  if (!session) throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
  const [row] = await Booking.aggregate([
    { $match: { sessionId: session._id, active: true } },
    { $group: { _id: null, seats: { $sum: '$seats' } } },
  ]);
  const max = session.seatsTotal - (row?.seats || 0);
  const target = seatsFree ?? session.seatsFree + delta;
  if (target < 0 || target > max) {
    throw new AppError(400, `Seats free must be between 0 and ${max}`, 'INVALID_SEATS');
  }
  session.seatsFree = target;
  await session.save();
  announceSeats(session);
  return session;
}

export async function listLiveCabs(routeId, stopId, toStopId) {
  const g = await getRouteGeometry(routeId);
  const stop = g.stops.find((s) => s.stopId === stopId);
  if (!stop) throw new AppError(400, 'Stop is not on this route', 'INVALID_STOPS');

  let fare = null;
  if (toStopId) {
    const toStop = g.stops.find((s) => s.stopId === toStopId);
    if (!toStop || toStop.order <= stop.order) {
      throw new AppError(400, 'Drop-off must come after the pick-up stop', 'INVALID_STOPS');
    }
    fare = await getFare(routeId, stop.stopId, toStop.stopId).catch(() => null);
  }

  const sessions = await DriverSession.find({
    routeId,
    active: true,
    online: true,
    lastSeen: { $gte: new Date(Date.now() - CAB_FRESH_MS) },
  })
    .populate({
      path: 'driverId',
      select: 'ratingAvg ratingCount profilePhotoKey userId',
      populate: { path: 'userId', select: 'name' },
    })
    .populate('vehicleId', 'plate make model colour kind seatCapacity')
    .lean();

  const cabs = [];
  let passed = 0; // live cabs on this route that are already past the pick-up stop
  for (const s of sessions) {
    const pos = getLivePosition(s);
    if (!pos) continue;
    const hit = project(g.path, pos);
    if (OFF_ROUTE_METERS > 0 && hit.distFrom > OFF_ROUTE_METERS) continue; // not actually on this route
    const remaining = stop.distAlong - hit.distAlong;
    if (remaining < -PASSED_METERS) { passed += 1; continue; }
    cabs.push({
      sessionId: String(s._id),
      seatsFree: s.seatsFree,
      seatsTotal: s.seatsTotal,
      full: s.seatsFree === 0,
      distanceMeters: Math.max(0, Math.round(remaining)),
      etaSeconds: etaSeconds(remaining, pos.speed),
      location: { lat: pos.lat, lng: pos.lng, heading: pos.heading },
      driver: {
        name: s.driverId?.userId?.name?.split(' ')[0] || 'Driver',
        ratingAvg: s.driverId?.ratingAvg || 0,
        ratingCount: s.driverId?.ratingCount || 0,
        photoUrl: await fileUrl(s.driverId?.profilePhotoKey),
      },
      vehicle: s.vehicleId
        ? { plate: s.vehicleId.plate, make: s.vehicleId.make, model: s.vehicleId.model, colour: s.vehicleId.colour, kind: vehicleKind(s.vehicleId), seatCapacity: s.vehicleId.seatCapacity }
        : null,
      tier: seatTier(s.seatsTotal, s.seatsCapacity),
      baseFare: fare,
      fare: tierFare(fare, s.seatsTotal, s.seatsCapacity),
    });
  }
  cabs.sort((a, b) => a.etaSeconds - b.etaSeconds);
  cabs.passed = passed; // read by the cab list screen to explain an empty list
  return cabs;
}

async function ownedSession(driver, sessionId) {
  const session = await DriverSession.findOne({ _id: sessionId, driverId: driver._id }).lean();
  if (!session) throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
  return session;
}

export async function listSessionBookings(driver, sessionId) {
  const session = await ownedSession(driver, sessionId);
  const g = await getRouteGeometry(session.routeId, { activeOnly: false });
  const names = new Map(g.stops.map((s) => [s.stopId, s.name]));
  const bookings = await Booking.find({ sessionId, active: true })
    .sort('requestedAt')
    .populate('passengerId', 'name ratingAvg ratingCount')
    .lean();
  return bookings.map((b) => ({
    atStop: Boolean(b.atStopAt),
    id: String(b._id),
    status: b.status,
    seats: b.seats,
    fare: b.fare,
    paymentMethod: b.paymentMethod,
    passenger: { name: b.passengerId?.name || 'Passenger', ratingAvg: b.passengerId?.ratingAvg || 0, ratingCount: b.passengerId?.ratingCount || 0 },
    from: { id: String(b.fromStopId), name: names.get(String(b.fromStopId)) },
    to: { id: String(b.toStopId), name: names.get(String(b.toStopId)) },
  }));
}

export async function waitingByStop(driver, sessionId) {
  const session = await ownedSession(driver, sessionId);
  const g = await getRouteGeometry(session.routeId, { activeOnly: false });
  const pos = getLivePosition(session);
  const progress = pos ? project(g.path, pos).distAlong : 0;
  const rows = await Booking.aggregate([
    { $match: { sessionId: session._id, status: { $in: ['confirmed', 'arriving'] } } },
    { $group: { _id: '$fromStopId', people: { $sum: '$seats' } } },
  ]);
  const counts = new Map(rows.map((r) => [String(r._id), r.people]));
  // >>> FEATURE: DRIVER DEMAND ALERTS (start). Riders who looked but have not booked. Empty when the feature is off.
  const looking = await lookingByStop(session.routeId);
  // <<< FEATURE: DRIVER DEMAND ALERTS (end)
  return g.stops
    .filter((s) => (counts.has(s.stopId) || looking.has(s.stopId)) && s.distAlong >= progress - PASSED_METERS)
    .map((s) => ({ stopId: s.stopId, name: s.name, people: counts.get(s.stopId) || 0, looking: looking.get(s.stopId) || 0 }));
}

// What the driver does next, nearest first: pick-ups (booked riders waiting) and drop-offs (riders in the cab).
export async function nextStops(driver, sessionId) {
  const session = await ownedSession(driver, sessionId);
  const g = await getRouteGeometry(session.routeId, { activeOnly: false });
  const pos = getLivePosition(session);
  const progress = pos ? project(g.path, pos).distAlong : 0;
  const bookings = await Booking.find({ sessionId: session._id, status: { $in: ['confirmed', 'arriving', 'picked_up'] } })
    .select('fromStopId toStopId status seats')
    .lean();
  const byKey = new Map();
  for (const b of bookings) {
    const kind = b.status === 'picked_up' ? 'dropoff' : 'pickup';
    const stopId = String(kind === 'pickup' ? b.fromStopId : b.toStopId);
    const key = `${kind}:${stopId}`;
    byKey.set(key, { kind, stopId, people: (byKey.get(key)?.people || 0) + (b.seats || 1) });
  }
  const out = [];
  for (const e of byKey.values()) {
    const stop = g.stops.find((s) => s.stopId === e.stopId);
    if (!stop) continue;
    const remaining = stop.distAlong - progress;
    if (pos && remaining < -PASSED_METERS) continue;
    out.push({
      ...e,
      name: stop.name,
      lat: stop.location.lat,
      lng: stop.location.lng,
      distanceMeters: pos ? Math.max(0, Math.round(remaining)) : null,
      etaSeconds: pos ? etaSeconds(Math.max(0, remaining), pos.speed) : null,
    });
  }
  return out.sort((a, b) => (a.distanceMeters ?? 1e12) - (b.distanceMeters ?? 1e12));
}

export async function markStaleSessions() {
  const cutoff = new Date(Date.now() - CAB_STALE_MS);
  const stale = await DriverSession.find({ active: true, online: true, lastSeen: { $lt: cutoff } })
    .select('routeId')
    .lean();
  if (!stale.length) return 0;
  await DriverSession.updateMany({ _id: { $in: stale.map((s) => s._id) } }, { $set: { online: false } });
  for (const s of stale) markOffline(s._id, s.routeId);
  return stale.length;
}

export async function closeAbandonedSessions() {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const old = await DriverSession.find({ active: true, lastSeen: { $lt: cutoff } });
  for (const s of old) await closeSession(s, 'The session timed out');
  return old.length;
}
