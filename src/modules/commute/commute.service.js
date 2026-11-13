import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { CommuteSchedule, CommuteTrip, CommuteBooking } from './commute.models.js';
import { Organization } from '../organizations/organization.model.js';
import { Driver } from '../drivers/driver.model.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { fileUrl } from '../uploads/storage.service.js';
import { toKobo, holdFunds, releaseHold, settleBookingDoc } from '../wallet/wallet.service.js';
import { emitToRoom, joinUserToRoom } from '../../realtime/io.js';
import { AppError } from '../../utils/AppError.js';
import { buildPath, project } from '../../utils/geo.js';
import { startOfDayLagos, lagosWeekday, lagosDayFromString } from '../../utils/time.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const MAX_ACTIVE_SCHEDULES = 4;
const LOCATION_WRITE_MS = 10 * 1000;

const first = (name) => (name ? name.split(' ')[0] : 'Driver');
const when = (d) =>
  new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
const genCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

async function requireOrg(user) {
  const o = user.organization;
  if (!o?.orgId) throw new AppError(403, 'Join your organisation first', 'ORG_REQUIRED');
  if (!o.verified) {
    throw new AppError(403, 'Your organisation membership is waiting for verification', 'ORG_NOT_VERIFIED');
  }
  const org = await Organization.findById(o.orgId).lean();
  if (!org?.active) throw new AppError(403, 'This organisation is not active', 'ORG_INACTIVE');
  return org;
}

function tripShape(direction, org, home, waypoints) {
  const hub = { name: org.name, lat: org.location.lat, lng: org.location.lng };
  const house = { name: home.name || 'Home area', lat: home.lat, lng: home.lng };
  const mid = waypoints.map((w) => ({ lat: w.lat, lng: w.lng }));
  if (direction === 'to_work') {
    return { origin: house, destination: hub, path: [house, ...mid, hub].map(({ lat, lng }) => ({ lat, lng })) };
  }
  return {
    origin: hub,
    destination: house,
    path: [hub, ...[...mid].reverse(), house].map(({ lat, lng }) => ({ lat, lng })),
  };
}

function tripFields(src, org, direction) {
  return {
    driverId: src.driverId,
    driverUserId: src.driverUserId,
    orgId: org._id,
    direction,
    durationMinutes: src.durationMinutes,
    seatsTotal: src.seatsTotal,
    seatsFree: src.seatsTotal,
    pricePerSeat: src.pricePerSeat,
    maxDetourMeters: src.maxDetourMeters,
    ...tripShape(direction, org, src.home, src.waypoints || []),
  };
}

function checkLimits(body, org, vehicle) {
  const seatsTotal = body.seatsTotal ?? vehicle.seatCapacity;
  if (seatsTotal > vehicle.seatCapacity) {
    throw new AppError(400, `Your vehicle has ${vehicle.seatCapacity} passenger seats`, 'INVALID_SEATS');
  }
  if (body.pricePerSeat > org.maxPricePerSeat) {
    throw new AppError(400, `The maximum contribution per seat is N${org.maxPricePerSeat}`, 'PRICE_TOO_HIGH');
  }
  return seatsTotal;
}

export async function generateTripsForSchedule(schedule, org, horizonDays = 14) {
  const now = Date.now();
  const ops = [];
  for (let i = 0; i < horizonDays; i++) {
    const dayStart = startOfDayLagos(new Date(now + i * DAY_MS));
    if (!schedule.daysOfWeek.includes(lagosWeekday(dayStart))) continue;
    const [h, m] = schedule.timeOfDay.split(':').map(Number);
    const departAt = new Date(dayStart.getTime() + (h * 60 + m) * MIN_MS);
    if (departAt.getTime() <= now + 5 * MIN_MS) continue;
    ops.push({
      updateOne: {
        filter: { scheduleId: schedule._id, departAt },
        update: { $setOnInsert: { ...tripFields(schedule, org, schedule.direction), status: 'scheduled' } },
        upsert: true,
      },
    });
  }
  if (ops.length) {
    try {
      await CommuteTrip.bulkWrite(ops, { ordered: false });
    } catch (err) {
      if (err.code !== 11000 && !err.writeErrors?.every((e) => e.err?.code === 11000)) throw err;
    }
  }
  await CommuteSchedule.updateOne({ _id: schedule._id }, { $set: { generatedUntil: new Date(now + horizonDays * DAY_MS) } });
  return ops.length;
}

export async function generateAllSchedules() {
  const schedules = await CommuteSchedule.find({ active: true });
  let n = 0;
  for (const s of schedules) {
    const org = await Organization.findById(s.orgId);
    if (org?.active) n += await generateTripsForSchedule(s, org);
  }
  return n;
}

export async function createSchedules(user, driver, body) {
  const org = await requireOrg(user);
  const count = await CommuteSchedule.countDocuments({ driverUserId: user._id, active: true });
  if (count + body.trips.length > MAX_ACTIVE_SCHEDULES) {
    throw new AppError(409, `You can have at most ${MAX_ACTIVE_SCHEDULES} active schedules`, 'TOO_MANY_SCHEDULES');
  }
  const seatsTotal = checkLimits(body, org, driver.vehicleId);
  const created = [];
  for (const spec of body.trips) {
    const schedule = await CommuteSchedule.create({
      driverId: driver._id,
      driverUserId: user._id,
      orgId: org._id,
      direction: spec.direction,
      timeOfDay: spec.timeOfDay,
      daysOfWeek: [...new Set(body.daysOfWeek)],
      home: body.home,
      waypoints: body.waypoints,
      seatsTotal,
      pricePerSeat: body.pricePerSeat,
      durationMinutes: body.durationMinutes,
      maxDetourMeters: body.maxDetourMeters,
    });
    await generateTripsForSchedule(schedule, org);
    created.push(schedule);
  }
  return created;
}

export async function createOneOffTrip(user, driver, body) {
  const org = await requireOrg(user);
  const t = body.departAt.getTime();
  if (t < Date.now() + 5 * MIN_MS || t > Date.now() + 30 * DAY_MS) {
    throw new AppError(400, 'Departure must be between 5 minutes and 30 days from now', 'INVALID_TIME');
  }
  const seatsTotal = checkLimits(body, org, driver.vehicleId);
  return CommuteTrip.create({
    ...tripFields({ ...body, seatsTotal, driverId: driver._id, driverUserId: user._id }, org, body.direction),
    departAt: body.departAt,
  });
}

export const listSchedules = (user) =>
  CommuteSchedule.find({ driverUserId: user._id, active: true }).sort('direction timeOfDay').lean();

export async function removeSchedule(user, scheduleId) {
  const s = await CommuteSchedule.findOneAndUpdate(
    { _id: scheduleId, driverUserId: user._id, active: true },
    { $set: { active: false } }
  );
  if (!s) throw new AppError(404, 'Schedule not found', 'NOT_FOUND');
  const trips = await CommuteTrip.find({ scheduleId, status: 'scheduled', departAt: { $gt: new Date() } }).select('_id');
  for (const t of trips) await closeTrip(t._id, 'The driver removed this schedule');
  return { cancelledTrips: trips.length };
}

async function driversFor(trips) {
  const ids = [...new Set(trips.map((t) => String(t.driverId)))];
  const docs = await Driver.find({ _id: { $in: ids } })
    .populate('userId', 'name')
    .populate('vehicleId', 'plate make model colour')
    .lean();
  const map = new Map();
  for (const d of docs) {
    map.set(String(d._id), {
      name: first(d.userId?.name),
      ratingAvg: d.ratingAvg || 0,
      ratingCount: d.ratingCount || 0,
      photoUrl: await fileUrl(d.profilePhotoKey),
      vehicle: d.vehicleId
        ? { plate: d.vehicleId.plate, make: d.vehicleId.make, model: d.vehicleId.model, colour: d.vehicleId.colour }
        : null,
    });
  }
  return map;
}

function presentTrip(t, drivers, extra = {}) {
  return {
    id: String(t._id),
    direction: t.direction,
    status: t.status,
    departAt: t.departAt,
    durationMinutes: t.durationMinutes,
    origin: t.origin,
    destination: t.destination,
    path: (t.path || []).map((p) => [p.lat, p.lng]),
    seatsFree: t.seatsFree,
    seatsTotal: t.seatsTotal,
    pricePerSeat: t.pricePerSeat,
    maxDetourMeters: t.maxDetourMeters,
    lastLocation: t.lastLocation || null,
    driver: drivers?.get(String(t.driverId)) || null,
    ...extra,
  };
}

export async function searchTrips(user, { direction, date, lat, lng }) {
  const org = await requireOrg(user);
  const now = new Date();
  const from = date ? lagosDayFromString(date) : now;
  const to = date ? new Date(from.getTime() + DAY_MS) : new Date(now.getTime() + 2 * DAY_MS);
  const trips = await CommuteTrip.find({
    orgId: org._id,
    direction,
    status: 'scheduled',
    seatsFree: { $gt: 0 },
    driverUserId: { $ne: user._id },
    departAt: { $gt: now > from ? now : from, $lt: to },
  })
    .sort('departAt')
    .limit(100)
    .lean();

  const matches = [];
  for (const t of trips) {
    const path = buildPath(t.path);
    const hit = project(path, { lat, lng });
    if (hit.distFrom > t.maxDetourMeters) continue;
    const estTime = new Date(t.departAt.getTime() + (hit.distAlong / path.length) * t.durationMinutes * MIN_MS);
    matches.push({ t, extra: { distFromPathMeters: Math.round(hit.distFrom), estTime } });
  }
  const drivers = await driversFor(matches.map((m) => m.t));
  return matches.map((m) => presentTrip(m.t, drivers, m.extra)).sort((a, b) => a.estTime - b.estTime);
}

async function releaseCommuteSeat(tripId) {
  await CommuteTrip.findOneAndUpdate(
    { _id: tripId, $expr: { $lt: ['$seatsFree', '$seatsTotal'] } },
    { $inc: { seatsFree: 1 } }
  );
}

export async function bookTrip(user, { tripId, lat, lng, label, paymentMethod = 'cash' }) {
  const org = await requireOrg(user);
  const trip = await CommuteTrip.findById(tripId).lean();
  if (!trip || String(trip.orgId) !== String(org._id)) throw new AppError(404, 'Trip not found', 'NOT_FOUND');
  if (String(trip.driverUserId) === String(user._id)) {
    throw new AppError(400, 'You cannot book your own trip', 'OWN_TRIP');
  }
  if (trip.status !== 'scheduled' || trip.departAt <= new Date()) {
    throw new AppError(409, 'This trip is no longer open for booking', 'TRIP_CLOSED');
  }
  const path = buildPath(trip.path);
  const hit = project(path, { lat, lng });
  if (hit.distFrom > trip.maxDetourMeters) {
    throw new AppError(400, 'Your location is too far from this driver\'s route', 'PIN_TOO_FAR');
  }
  if (await CommuteBooking.exists({ tripId, passengerId: user._id, active: true })) {
    throw new AppError(409, 'You already booked this trip', 'ALREADY_BOOKED');
  }

  const bookingId = new mongoose.Types.ObjectId();
  const heldKobo = paymentMethod === 'wallet' && trip.pricePerSeat > 0 ? toKobo(trip.pricePerSeat) : 0;
  const hold = { userId: user._id, driverUserId: trip.driverUserId, kind: 'commute', refId: String(bookingId), kobo: heldKobo };
  if (heldKobo) await holdFunds(hold);

  const updated = await CommuteTrip.findOneAndUpdate(
    { _id: tripId, status: 'scheduled', departAt: { $gt: new Date() }, seatsFree: { $gte: 1 } },
    { $inc: { seatsFree: -1 } },
    { new: true }
  );
  if (!updated) {
    if (heldKobo) await releaseHold(hold);
    throw new AppError(409, 'No seats left on this trip', 'NO_SEATS');
  }

  let booking;
  try {
    for (let i = 0; i < 6 && !booking; i++) {
      try {
        booking = await CommuteBooking.create({
          _id: bookingId,
          paymentMethod: heldKobo ? 'wallet' : 'cash',
          heldKobo,
          tripId,
          passengerId: user._id,
          driverUserId: trip.driverUserId,
          orgId: org._id,
          pin: { lat, lng, label },
          pinKind: trip.direction === 'to_work' ? 'pickup' : 'dropoff',
          distFromPathMeters: Math.round(hit.distFrom),
          estTime: new Date(trip.departAt.getTime() + (hit.distAlong / path.length) * trip.durationMinutes * MIN_MS),
          pricePerSeat: trip.pricePerSeat,
          code: genCode(),
        });
      } catch (e) {
        if (e.code === 11000 && e.keyPattern?.code) continue;
        throw e;
      }
    }
    if (!booking) throw new AppError(503, 'Could not create the booking, try again', 'TRY_AGAIN');
  } catch (e) {
    await releaseCommuteSeat(tripId);
    if (heldKobo) await releaseHold(hold);
    if (e.code === 11000 && e.keyPattern?.passengerId) {
      throw new AppError(409, 'You already booked this trip', 'ALREADY_BOOKED');
    }
    throw e;
  }

  joinUserToRoom(user._id, `commute:${tripId}`);
  notifyUser(
    trip.driverUserId,
    'commute:booking',
    { tripId: String(tripId), bookingId: String(booking._id) },
    { title: 'New carpool rider', body: `${first(user.name)} booked a seat for ${when(trip.departAt)}.` }
  );
  return booking;
}

function presentBooking(b, trip, drivers) {
  return {
    id: String(b._id),
    status: b.status,
    active: b.active,
    pin: b.pin,
    pinKind: b.pinKind,
    estTime: b.estTime,
    pricePerSeat: b.pricePerSeat,
    paymentMethod: b.paymentMethod,
    ...(b.active && { code: b.code }),
    trip: trip ? presentTrip(trip, drivers) : null,
  };
}

export async function myBookings(user) {
  const bookings = await CommuteBooking.find({ passengerId: user._id }).sort('-createdAt').limit(40).lean();
  const trips = await CommuteTrip.find({ _id: { $in: bookings.map((b) => b.tripId) } }).lean();
  const tripById = new Map(trips.map((t) => [String(t._id), t]));
  const drivers = await driversFor(trips);
  const all = bookings.map((b) => presentBooking(b, tripById.get(String(b.tripId)), drivers));
  return {
    active: all.filter((b) => b.active).sort((a, b) => new Date(a.trip?.departAt) - new Date(b.trip?.departAt)),
    past: all.filter((b) => !b.active),
  };
}

export async function cancelMyBooking(user, bookingId) {
  const b = await CommuteBooking.findOne({ _id: bookingId, passengerId: user._id });
  if (!b) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  const trip = await CommuteTrip.findById(b.tripId).lean();
  if (!trip || trip.status !== 'scheduled') {
    throw new AppError(409, 'This trip has already started, so the booking cannot be cancelled', 'NOT_CANCELLABLE');
  }
  const updated = await CommuteBooking.findOneAndUpdate(
    { _id: bookingId, status: 'confirmed' },
    { $set: { status: 'cancelled', active: false, cancelledBy: 'passenger', cancelledAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new AppError(409, `A ${b.status} booking cannot be cancelled`, 'NOT_CANCELLABLE');
  await releaseCommuteSeat(b.tripId);
  await settleBookingDoc('commute', updated);
  notifyUser(
    b.driverUserId,
    'commute:booking',
    { tripId: String(b.tripId), bookingId: String(b._id), status: 'cancelled' },
    { title: 'Rider cancelled', body: `${first(user.name)} cancelled their seat for ${when(trip.departAt)}.` }
  );
  return { id: String(b._id), status: 'cancelled' };
}

export async function listDriverTrips(user) {
  const trips = await CommuteTrip.find({
    driverUserId: user._id,
    status: { $in: ['scheduled', 'in_progress'] },
    departAt: { $gte: new Date(Date.now() - 3 * 60 * MIN_MS) },
  })
    .sort('departAt')
    .limit(60)
    .lean();
  const counts = await CommuteBooking.aggregate([
    { $match: { tripId: { $in: trips.map((t) => t._id) }, active: true } },
    { $group: { _id: '$tripId', n: { $sum: 1 } } },
  ]);
  const byTrip = new Map(counts.map((c) => [String(c._id), c.n]));
  return trips.map((t) => presentTrip(t, null, { bookedCount: byTrip.get(String(t._id)) || 0 }));
}

async function ownTrip(user, tripId) {
  const trip = await CommuteTrip.findOne({ _id: tripId, driverUserId: user._id });
  if (!trip) throw new AppError(404, 'Trip not found', 'NOT_FOUND');
  return trip;
}

export async function tripBookings(user, tripId) {
  await ownTrip(user, tripId);
  const rows = await CommuteBooking.find({ tripId }).sort('estTime').populate('passengerId', 'name').lean();
  return rows.map((b) => ({
    id: String(b._id),
    status: b.status,
    passenger: { name: first(b.passengerId?.name) || 'Colleague' },
    pin: b.pin,
    pinKind: b.pinKind,
    estTime: b.estTime,
    distFromPathMeters: b.distFromPathMeters,
  }));
}

export async function startTrip(user, tripId) {
  const trip = await ownTrip(user, tripId);
  if (trip.status !== 'scheduled') throw new AppError(409, `Trip is ${trip.status}`, 'INVALID_STATE');
  const t = trip.departAt.getTime();
  if (Date.now() < t - 60 * MIN_MS || Date.now() > t + 120 * MIN_MS) {
    throw new AppError(409, 'You can start a trip from 60 minutes before to 2 hours after departure', 'OUTSIDE_WINDOW');
  }
  const updated = await CommuteTrip.findOneAndUpdate(
    { _id: tripId, status: 'scheduled' },
    { $set: { status: 'in_progress', startedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new AppError(409, 'Trip already started', 'INVALID_STATE');
  joinUserToRoom(user._id, `commute:${tripId}`);
  const riders = await CommuteBooking.find({ tripId, status: 'confirmed' }).select('passengerId').lean();
  for (const r of riders) {
    notifyUser(
      r.passengerId,
      'commute:started',
      { tripId: String(tripId) },
      { title: 'Your carpool is on the way', body: `${first(user.name)} has started the trip. Get ready.`, sms: true }
    );
  }
  return presentTrip(updated.toObject());
}

export async function completeTrip(user, driver, tripId) {
  const trip = await ownTrip(user, tripId);
  const updated = await CommuteTrip.findOneAndUpdate(
    { _id: tripId, status: 'in_progress' },
    { $set: { status: 'completed', completedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new AppError(409, `Trip is ${trip.status}`, 'INVALID_STATE');
  const done = await CommuteBooking.find({ tripId, active: true }).select('passengerId status').lean();
  await CommuteBooking.updateMany({ tripId, status: 'picked_up' }, { $set: { status: 'completed', active: false, completedAt: new Date() } });
  await CommuteBooking.updateMany({ tripId, status: 'confirmed' }, { $set: { status: 'no_show', active: false } });
  await Driver.updateOne({ _id: driver._id }, { $inc: { totalTrips: 1 } });
  await settleTripBookings(tripId);
  for (const b of done.filter((x) => x.status === 'picked_up')) {
    notifyUser(b.passengerId, 'commute:status', { tripId: String(tripId), status: 'completed' });
  }
  return presentTrip(updated.toObject());
}

async function settleTripBookings(tripId) {
  const docs = await CommuteBooking.find({
    tripId,
    heldKobo: { $gt: 0 },
    settledAt: null,
    status: { $in: ['completed', 'no_show', 'cancelled'] },
  });
  for (const d of docs) await settleBookingDoc('commute', d);
}

async function closeTrip(tripId, reason, { from = ['scheduled'], status = 'cancelled', sms = true } = {}) {
  const trip = await CommuteTrip.findOneAndUpdate(
    { _id: tripId, status: { $in: from } },
    { $set: { status, cancelReason: reason } },
    { new: true }
  );
  if (!trip) return null;
  const bookings = await CommuteBooking.find({ tripId, status: 'confirmed' }).select('passengerId').lean();
  if (bookings.length) {
    await CommuteBooking.updateMany(
      { _id: { $in: bookings.map((b) => b._id) } },
      { $set: { status: 'cancelled', active: false, cancelledBy: 'driver', cancelledAt: new Date() } }
    );
    await settleTripBookings(tripId);
    for (const b of bookings) {
      notifyUser(
        b.passengerId,
        'commute:status',
        { tripId: String(tripId), status },
        { title: 'Carpool cancelled', body: `Your carpool on ${when(trip.departAt)} was cancelled: ${reason}.`, sms }
      );
    }
  }
  return trip;
}

export async function cancelTrip(user, tripId, reason) {
  await ownTrip(user, tripId);
  const trip = await closeTrip(tripId, reason || 'The driver cancelled');
  if (!trip) throw new AppError(409, 'Only a trip that has not started can be cancelled', 'INVALID_STATE');
  return presentTrip(trip.toObject());
}

export async function adminCancelTrip(tripId, reason) {
  const trip = await closeTrip(tripId, reason || 'Cancelled by support', { from: ['scheduled', 'in_progress'] });
  if (!trip) throw new AppError(409, 'Trip is not active', 'INVALID_STATE');
  return presentTrip(trip.toObject());
}

export async function adminListTrips({ status, orgId, skip, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (orgId) filter.orgId = orgId;
  const [trips, total] = await Promise.all([
    CommuteTrip.find(filter).sort('-departAt').skip(skip).limit(limit).populate('driverUserId', 'name phone').lean(),
    CommuteTrip.countDocuments(filter),
  ]);
  return { total, trips };
}

async function driverBooking(user, bookingId) {
  const b = await CommuteBooking.findOne({ _id: bookingId, driverUserId: user._id });
  if (!b) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  const trip = await CommuteTrip.findById(b.tripId).select('status').lean();
  if (trip?.status !== 'in_progress') throw new AppError(409, 'Start the trip first', 'TRIP_NOT_STARTED');
  return b;
}

export async function pickupRider(user, bookingId, code) {
  const b = await driverBooking(user, bookingId);
  if (b.code !== code) throw new AppError(400, 'Wrong trip code', 'WRONG_CODE');
  const updated = await CommuteBooking.findOneAndUpdate(
    { _id: bookingId, status: 'confirmed' },
    { $set: { status: 'picked_up', pickedUpAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new AppError(409, `Booking is ${b.status}`, 'INVALID_STATE');
  notifyUser(b.passengerId, 'commute:status', { tripId: String(b.tripId), status: 'picked_up' });
  return { id: String(updated._id), status: updated.status };
}

export async function noShowRider(user, bookingId) {
  const b = await driverBooking(user, bookingId);
  const updated = await CommuteBooking.findOneAndUpdate(
    { _id: bookingId, status: 'confirmed' },
    { $set: { status: 'no_show', active: false } },
    { new: true }
  );
  if (!updated) throw new AppError(409, `Booking is ${b.status}`, 'INVALID_STATE');
  await settleBookingDoc('commute', updated);
  return { id: String(updated._id), status: updated.status };
}

const locCache = new Map();

export async function recordCommuteLocation({ userId, tripId, lat, lng }) {
  const id = String(tripId);
  let entry = locCache.get(id);
  if (!entry || Date.now() - entry.checkedAt > 60 * 1000) {
    const ok = await CommuteTrip.exists({ _id: id, driverUserId: userId, status: 'in_progress' });
    if (!ok) {
      locCache.delete(id);
      throw new AppError(404, 'Trip is not in progress', 'NOT_IN_PROGRESS');
    }
    entry = { checkedAt: Date.now(), lastWrite: entry?.lastWrite || 0 };
    locCache.set(id, entry);
  }
  const now = Date.now();
  if (now - entry.lastWrite >= LOCATION_WRITE_MS) {
    entry.lastWrite = now;
    await CommuteTrip.updateOne({ _id: id }, { $set: { lastLocation: { lat, lng, at: new Date(now) } } });
  }
  emitToRoom(`commute:${id}`, 'commute:location', { tripId: id, lat, lng, at: new Date(now).toISOString() });
}

export async function sendCommuteReminders() {
  const now = new Date();
  const trips = await CommuteTrip.find({
    status: 'scheduled',
    reminded: false,
    departAt: { $gt: now, $lte: new Date(now.getTime() + 31 * MIN_MS) },
  }).limit(100);
  for (const t of trips) {
    const claimed = await CommuteTrip.findOneAndUpdate({ _id: t._id, reminded: false }, { $set: { reminded: true } });
    if (!claimed) continue;
    notifyUser(
      t.driverUserId,
      'commute:reminder',
      { tripId: String(t._id) },
      { title: 'Carpool leaves soon', body: 'Your carpool leaves in about 30 minutes. Start the trip when you set off.' }
    );
    const riders = await CommuteBooking.find({ tripId: t._id, status: 'confirmed' }).select('passengerId').lean();
    for (const r of riders) {
      notifyUser(
        r.passengerId,
        'commute:reminder',
        { tripId: String(t._id) },
        { title: 'Carpool leaves soon', body: `Your carpool leaves around ${when(t.departAt)}. Be at your pin in time.` }
      );
    }
  }
  return trips.length;
}

export async function expireCommuteTrips() {
  const stale = await CommuteTrip.find({ status: 'scheduled', departAt: { $lt: new Date(Date.now() - 120 * MIN_MS) } })
    .select('_id')
    .limit(200)
    .lean();
  for (const { _id } of stale) await closeTrip(_id, 'The trip did not start', { status: 'expired', sms: false });
  return stale.length;
}
