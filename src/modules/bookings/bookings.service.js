import { emailUser, appLink } from '../notifications/email.notify.js';
import { tierFare } from '../sessions/pricing.js';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Booking } from './booking.model.js';
import { DriverSession } from '../sessions/session.model.js';
import { Driver } from '../drivers/driver.model.js';
import { getRouteGeometry, getFare } from '../routes/routes.service.js';
import { announceSeats, getLivePosition } from '../sessions/sessions.live.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { joinUserToRoom } from '../../realtime/io.js';
import { toKobo, holdFunds, releaseHold, settleBookingDoc } from '../wallet/wallet.service.js';
import { project, etaSeconds } from '../../utils/geo.js';
import { fileUrl } from '../uploads/storage.service.js';
import { AppError } from '../../utils/AppError.js';
import { env, riderUrl } from '../../config/env.js';
import {
  ACTIVE_BOOKING_STATUSES,
  BOOKING_EXPIRY_MS,
  CAB_FRESH_MS,
  LATE_CANCEL_FEE_NAIRA,
  STRIKE_LIMIT,
  PASSED_METERS,
  SHARE_AFTER_TRIP_MS,
} from '../../config/constants.js';

const genCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
const freshSince = () => new Date(Date.now() - CAB_FRESH_MS);

export async function releaseSeats(sessionId, seats) {
  const fits = await DriverSession.findOneAndUpdate(
    { _id: sessionId, active: true, $expr: { $lte: [{ $add: ['$seatsFree', seats] }, '$seatsTotal'] } },
    { $inc: { seatsFree: seats } },
    { new: true }
  );
  if (fits) return announceSeats(fits);
  const current = await DriverSession.findOne({ _id: sessionId, active: true }).select('seatsTotal');
  if (!current) return;
  const capped = await DriverSession.findOneAndUpdate(
    { _id: sessionId },
    { $set: { seatsFree: current.seatsTotal } },
    { new: true }
  );
  if (capped) announceSeats(capped);
}

async function transition(id, from, status, extra = {}) {
  return Booking.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: { status, active: ACTIVE_BOOKING_STATUSES.includes(status), ...extra } },
    { new: true }
  );
}

const firstName = (name) => (name ? name.split(' ')[0] : 'Driver');

export async function presentBooking(input, { withLive = false, includeCode = true } = {}) {
  const b = input.toObject ? input.toObject() : input;
  const g = await getRouteGeometry(b.routeId, { activeOnly: false });
  const names = new Map(g.stops.map((s) => [s.stopId, s]));
  const driver = await Driver.findById(b.driverId)
    .populate('userId', 'name')
    .populate('vehicleId', 'plate make model colour')
    .lean();

  const view = {
    id: String(b._id),
    status: b.status,
    seats: b.seats,
    fare: b.fare,
    farePerSeat: b.farePerSeat,
    paymentMethod: b.paymentMethod,
    paymentConfirmed: b.paymentConfirmed,
    route: { id: g.route.id, name: g.route.name },
    from: { id: String(b.fromStopId), name: names.get(String(b.fromStopId))?.name },
    to: { id: String(b.toStopId), name: names.get(String(b.toStopId))?.name },
    driver: {
      name: firstName(driver?.userId?.name),
      ratingAvg: driver?.ratingAvg || 0,
      ratingCount: driver?.ratingCount || 0,
      photoUrl: await fileUrl(driver?.profilePhotoKey),
    },
    vehicle: driver?.vehicleId
      ? { plate: driver.vehicleId.plate, make: driver.vehicleId.make, model: driver.vehicleId.model, colour: driver.vehicleId.colour }
      : null,
    requestedAt: b.requestedAt,
    confirmedAt: b.confirmedAt,
    arrivingAt: b.arrivingAt,
    pickedUpAt: b.pickedUpAt,
    completedAt: b.completedAt,
    cancelledAt: b.cancelledAt,
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    rated: b.rated,
    atStopAt: b.atStopAt,
    // What the rider is told to build trust: the seat is theirs, and what happens to the money.
    heldNaira: b.heldKobo ? Math.round(b.heldKobo / 100) : 0,
    lateCancelFee: LATE_CANCEL_FEE_NAIRA,
    cancelFee: b.cancelFeeKobo ? Math.round(b.cancelFeeKobo / 100) : 0,
  };
  if (includeCode && b.active) view.code = b.code;

  if (withLive && b.active) {
    const session = await DriverSession.findById(b.sessionId).lean();
    const pos = session && getLivePosition(session);
    const from = names.get(String(b.fromStopId));
    if (pos && from) {
      const remaining = from.distAlong - project(g.path, pos).distAlong;
      view.cab = {
        sessionId: String(b.sessionId),
        location: { lat: pos.lat, lng: pos.lng, heading: pos.heading },
        seatsFree: session.seatsFree,
        distanceMeters: Math.max(0, Math.round(remaining)),
        etaSeconds: ['confirmed', 'arriving'].includes(b.status) ? etaSeconds(remaining, pos.speed) : null,
      };
      // Once the rider is in the cab: how far and how long to the drop-off stop.
      const to = names.get(String(b.toStopId));
      if (b.status === 'picked_up' && to) {
        const left = Math.max(0, to.distAlong - project(g.path, pos).distAlong);
        view.cab.toDistanceMeters = Math.round(left);
        view.cab.toEtaSeconds = etaSeconds(left, pos.speed);
      }
    }
  }
  return view;
}

export async function createBooking(user, { sessionId, fromStopId, toStopId, seats, paymentMethod }) {
  if (await Booking.exists({ passengerId: user._id, active: true })) {
    throw new AppError(409, 'You already have an active booking', 'ALREADY_BOOKED');
  }

  if (paymentMethod !== 'wallet' && STRIKE_LIMIT > 0) {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const strikes = await Booking.countDocuments({
      passengerId: user._id,
      $or: [{ status: 'no_show' }, { lateCancel: true }],
      updatedAt: { $gte: since },
    });
    if (strikes >= STRIKE_LIMIT) {
      throw new AppError(403, 'You missed or late-cancelled several rides recently, so for now you can only book by paying from your wallet.', 'WALLET_ONLY');
    }
  }

  const session = await DriverSession.findOne({
    _id: sessionId,
    active: true,
    online: true,
    lastSeen: { $gte: freshSince() },
  });
  if (!session) throw new AppError(409, 'This cab is no longer available', 'CAB_UNAVAILABLE');

  const driver = await Driver.findById(session.driverId).select('userId status');
  if (!driver || driver.status !== 'approved') {
    throw new AppError(409, 'This cab is no longer available', 'CAB_UNAVAILABLE');
  }

  const g = await getRouteGeometry(session.routeId);
  const from = g.stops.find((s) => s.stopId === fromStopId);
  const to = g.stops.find((s) => s.stopId === toStopId);
  if (!from || !to || from.order >= to.order) {
    throw new AppError(400, 'Stops must be on the cab\'s route, in travel order', 'INVALID_STOPS');
  }

  const pos = getLivePosition(session);
  if (!pos) throw new AppError(409, 'Cab location is not available yet', 'CAB_UNAVAILABLE');
  if (project(g.path, pos).distAlong > from.distAlong + PASSED_METERS) {
    throw new AppError(409, 'This cab has already passed your stop', 'CAB_PASSED');
  }

  const farePerSeat = tierFare(await getFare(session.routeId, from.stopId, to.stopId), session.seatsTotal, session.seatsCapacity);

  const bookingId = new mongoose.Types.ObjectId();
  const heldKobo = paymentMethod === 'wallet' ? toKobo(farePerSeat * seats) : 0;
  const hold = { userId: user._id, driverUserId: driver.userId, kind: 'ride', refId: String(bookingId), kobo: heldKobo };
  if (heldKobo) await holdFunds(hold);

  const updated = await DriverSession.findOneAndUpdate(
    { _id: session._id, active: true, online: true, lastSeen: { $gte: freshSince() }, seatsFree: { $gte: seats } },
    { $inc: { seatsFree: -seats } },
    { new: true }
  );
  if (!updated) {
    if (heldKobo) await releaseHold(hold);
    throw new AppError(409, 'Not enough seats left', 'NO_SEATS');
  }

  let booking;
  try {
    for (let i = 0; i < 6 && !booking; i++) {
      try {
        booking = await Booking.create({
          _id: bookingId,
          heldKobo,
          passengerId: user._id,
          driverId: session.driverId,
          driverUserId: driver.userId,
          sessionId: session._id,
          routeId: session.routeId,
          fromStopId,
          toStopId,
          seats,
          farePerSeat,
          fare: farePerSeat * seats,
          code: genCode(),
          status: 'confirmed',
          active: true,
          paymentMethod,
          confirmedAt: new Date(),
        });
      } catch (e) {
        if (e.code === 11000 && e.keyPattern?.code) continue;
        throw e;
      }
    }
    if (!booking) throw new AppError(503, 'Could not create the booking, try again', 'TRY_AGAIN');
  } catch (e) {
    await releaseSeats(session._id, seats);
    if (heldKobo) await releaseHold(hold);
    if (e.code === 11000 && e.keyPattern?.passengerId) {
      throw new AppError(409, 'You already have an active booking', 'ALREADY_BOOKED');
    }
    throw e;
  }

  announceSeats(updated);
  joinUserToRoom(user._id, `session:${session._id}`);
  notifyUser(
    driver.userId,
    'booking:created',
    { bookingId: String(booking._id), seats, from: from.name, passenger: firstName(user.name) },
    { title: 'New booking', body: `${seats} seat(s) booked from ${from.name}.` }
  );
  const view = await presentBooking(booking, { withLive: true });
  emailUser(user._id, {
    subject: `Seat booked: ${view.from.name} to ${view.to.name}`,
    heading: 'Your seat is booked',
    lines: [
      `${view.seats} seat${view.seats === 1 ? '' : 's'} reserved on ${view.route.name}. Show the code below to your driver when you board.`,
      view.paymentMethod === 'wallet' ? `₦${view.heldNaira} is held safely in your wallet and only goes to the driver when you board.` : 'Pay the driver in cash when you board.',
    ],
    rows: [
      ['Trip code', view.code],
      ['Pick-up', view.from.name],
      ['Drop-off', view.to.name],
      ['Fare', `₦${view.fare}`],
      ['Driver', view.driver.name],
      ...(view.vehicle ? [['Cab', `${view.vehicle.colour} ${view.vehicle.make} ${view.vehicle.model} · ${view.vehicle.plate}`]] : []),
    ],
    button: { label: 'Open my trip', url: `${appLink('passenger')}/trip` },
  });
  return view;
}

export async function getActiveBooking(user) {
  const booking = await Booking.findOne({ passengerId: user._id, active: true });
  return booking ? presentBooking(booking, { withLive: true }) : null;
}

export async function listHistory(user, { skip, limit }) {
  const rows = await Booking.find({ passengerId: user._id }).sort('-requestedAt').skip(skip).limit(limit).lean();
  return Promise.all(rows.map((b) => presentBooking(b, { includeCode: false })));
}

export async function cancelByPassenger(user, bookingId, reason) {
  const owned = await Booking.findOne({ _id: bookingId, passengerId: user._id });
  if (!owned) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  // Free while the cab is still on its way. Once it is "arriving" the driver is waiting, so a small fee applies (and it counts as a strike).
  const late = owned.status === 'arriving';
  const feeKobo = late && owned.heldKobo ? Math.min(owned.heldKobo, toKobo(LATE_CANCEL_FEE_NAIRA)) : 0;
  const updated = await transition(bookingId, ['confirmed', 'arriving'], 'cancelled', {
    cancelledBy: 'passenger',
    cancelReason: reason,
    cancelledAt: new Date(),
    lateCancel: late,
    cancelFeeKobo: feeKobo,
  });
  if (!updated) throw new AppError(409, `A ${owned.status} booking cannot be cancelled`, 'NOT_CANCELLABLE');
  await releaseSeats(updated.sessionId, updated.seats);
  await settleBookingDoc('ride', updated);
  notifyUser(
    updated.driverUserId,
    'booking:status',
    { bookingId: String(updated._id), status: 'cancelled' },
    { title: 'Booking cancelled', body: late ? 'A passenger cancelled as you arrived.' : 'A passenger cancelled their booking.' }
  );
  emailUser(updated.passengerId, {
    subject: 'Your FoloRide booking was cancelled',
    heading: 'Booking cancelled',
    lines: [
      'Your seat was released.',
      feeKobo ? `A cancellation fee of ₦${Math.round(feeKobo / 100)} was taken from your held fare because the cab was already arriving. The rest was returned to your wallet.` : updated.heldKobo ? 'The money held for this ride went back to your wallet.' : 'You have not been charged.',
    ],
  });
  return presentBooking(updated, { includeCode: false });
}

/** The rider taps "I'm at the stop": the driver sees it, so they know the seat is really being used. */
export async function markAtStop(user, bookingId) {
  const b = await Booking.findOneAndUpdate(
    { _id: bookingId, passengerId: user._id, status: { $in: ['confirmed', 'arriving'] }, atStopAt: null },
    { $set: { atStopAt: new Date() } },
    { new: true }
  );
  if (!b) {
    const own = await Booking.findOne({ _id: bookingId, passengerId: user._id });
    if (!own) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
    return presentBooking(own, { withLive: true });
  }
  notifyUser(
    b.driverUserId,
    'booking:status',
    { bookingId: String(b._id), status: b.status, atStop: true },
    { title: 'Rider is at the stop', body: 'Your passenger is waiting at the pick-up stop.' }
  );
  return presentBooking(b, { withLive: true });
}

async function driverBooking(driver, bookingId) {
  const b = await Booking.findOne({ _id: bookingId, driverId: driver._id });
  if (!b) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  return b;
}

const invalidState = (b) => new AppError(409, `Booking is ${b.status}`, 'INVALID_STATE');

export async function pickup(driver, bookingId, code) {
  const b = await driverBooking(driver, bookingId);
  if (b.code !== code) throw new AppError(400, 'Wrong trip code', 'WRONG_CODE');
  const updated = await transition(bookingId, ['confirmed', 'arriving'], 'picked_up', { pickedUpAt: new Date() });
  if (!updated) throw invalidState(b);
  notifyUser(updated.passengerId, 'booking:status', { bookingId: String(updated._id), status: 'picked_up' });
  return { id: String(updated._id), status: updated.status };
}

export async function complete(driver, bookingId, paymentConfirmed) {
  const b = await driverBooking(driver, bookingId);
  const updated = await transition(bookingId, ['picked_up'], 'completed', {
    completedAt: new Date(),
    paymentConfirmed: paymentConfirmed || b.paymentMethod === 'wallet',
  });
  if (!updated) throw invalidState(b);
  await releaseSeats(updated.sessionId, updated.seats);
  await settleBookingDoc('ride', updated);
  await Driver.updateOne({ _id: driver._id }, { $inc: { totalTrips: 1 } });
  presentBooking(updated, { includeCode: false }).then((v) => emailUser(updated.passengerId, {
    subject: `Trip receipt: ${v.from.name} to ${v.to.name}`,
    heading: 'Thanks for riding with FoloRide',
    lines: ['Here is your receipt. You can rate your driver in the app.'],
    rows: [
      ['Route', v.route.name],
      ['From', v.from.name],
      ['To', v.to.name],
      ['Seats', String(v.seats)],
      ['Paid', `₦${v.fare} (${v.paymentMethod === 'wallet' ? 'wallet' : 'cash'})`],
      ['Driver', v.driver.name],
      ...(v.vehicle ? [['Cab', v.vehicle.plate]] : []),
    ],
    button: { label: 'Rate my driver', url: `${appLink('passenger')}/activity` },
  })).catch(() => {});
  notifyUser(
    updated.passengerId,
    'booking:status',
    { bookingId: String(updated._id), status: 'completed' },
    { title: 'Trip complete', body: 'How was your ride? Rate your driver.' }
  );
  return { id: String(updated._id), status: updated.status };
}

export async function noShow(driver, bookingId) {
  const b = await driverBooking(driver, bookingId);
  const updated = await transition(bookingId, ['confirmed', 'arriving'], 'no_show', {
    cancelledBy: 'driver',
    cancelledAt: new Date(),
  });
  if (!updated) throw invalidState(b);
  await releaseSeats(updated.sessionId, updated.seats);
  await settleBookingDoc('ride', updated);
  notifyUser(
    updated.passengerId,
    'booking:status',
    { bookingId: String(updated._id), status: 'no_show' },
    { title: 'Missed your cab', body: 'The driver marked you as a no-show.', sms: true, email: true }
  );
  return { id: String(updated._id), status: updated.status };
}

export async function adminCancel(admin, bookingId, reason) {
  const updated = await transition(bookingId, ACTIVE_BOOKING_STATUSES, 'cancelled', {
    cancelledBy: 'admin',
    cancelReason: reason || 'Cancelled by FoloRide support',
    cancelledAt: new Date(),
  });
  if (!updated) throw new AppError(409, 'Booking is not active', 'INVALID_STATE');
  await releaseSeats(updated.sessionId, updated.seats);
  await settleBookingDoc('ride', updated);
  const payload = { bookingId: String(updated._id), status: 'cancelled' };
  const opts = { title: 'Booking cancelled', body: 'Your booking was cancelled by FoloRide support.', sms: true, email: true };
  notifyUser(updated.passengerId, 'booking:status', payload, opts);
  notifyUser(updated.driverUserId, 'booking:status', payload, { title: opts.title, body: opts.body });
  return { id: String(updated._id), status: updated.status };
}

export async function expireStaleBookings() {
  const cutoff = new Date(Date.now() - BOOKING_EXPIRY_MS);
  const stale = await Booking.find({ status: { $in: ['confirmed', 'arriving'] }, confirmedAt: { $lt: cutoff } })
    .select('_id')
    .limit(200)
    .lean();
  let count = 0;
  for (const { _id } of stale) {
    const updated = await transition(_id, ['confirmed', 'arriving'], 'expired', {
      cancelledBy: 'system',
      cancelReason: 'Booking timed out',
      cancelledAt: new Date(),
    });
    if (!updated) continue;
    count++;
    await releaseSeats(updated.sessionId, updated.seats);
  await settleBookingDoc('ride', updated);
    notifyUser(
      updated.passengerId,
      'booking:status',
      { bookingId: String(updated._id), status: 'expired' },
      { title: 'Booking expired', body: 'Your FoloRide booking expired because the pick-up did not happen.', email: true }
    );
  }
  return count;
}

export async function ensureShareToken(booking) {
  if (!booking.shareToken) {
    booking.shareToken = crypto.randomBytes(24).toString('hex');
    await booking.save();
  }
  return booking.shareToken;
}

export async function createShareLink(user, bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, passengerId: user._id });
  if (!booking) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  const token = await ensureShareToken(booking);
  return { token, url: `${riderUrl}/share/${token}` };
}

export async function getSharedTrip(token) {
  const b = await Booking.findOne({ shareToken: token }).populate('passengerId', 'name').lean();
  if (!b) throw new AppError(404, 'Trip link not found', 'NOT_FOUND');
  if (!b.active) {
    const ended = b.completedAt || b.cancelledAt || b.updatedAt;
    if (Date.now() - new Date(ended).getTime() > SHARE_AFTER_TRIP_MS) {
      throw new AppError(410, 'This trip link has expired', 'LINK_EXPIRED');
    }
  }
  const view = await presentBooking(b, { withLive: true, includeCode: false });
  return {
    status: view.status,
    sharedBy: firstName(b.passengerId?.name),
    route: view.route,
    from: view.from,
    to: view.to,
    driver: { name: view.driver.name },
    vehicle: view.vehicle,
    cab: view.cab ? { location: view.cab.location, etaSeconds: view.cab.etaSeconds } : null,
  };
}
