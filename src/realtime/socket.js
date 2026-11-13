import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { LOCATION_MIN_GAP_MS } from '../config/constants.js';
import { objectId } from '../utils/schemas.js';
import { User } from '../modules/users/user.model.js';
import { Driver } from '../modules/drivers/driver.model.js';
import { Route } from '../modules/routes/route.model.js';
import { Booking } from '../modules/bookings/booking.model.js';
import { DriverSession } from '../modules/sessions/session.model.js';
import { CommuteBooking, CommuteTrip } from '../modules/commute/commute.models.js';
import { recordCommuteLocation } from '../modules/commute/commute.service.js';
import { recordLocation } from '../modules/sessions/sessions.live.js';
import { setSeats } from '../modules/sessions/sessions.service.js';
import { locationSchema, seatsSchema } from '../modules/sessions/session.schema.js';

const locationPayload = locationSchema.extend({ sessionId: objectId });
const seatsPayload = z
  .object({
    sessionId: objectId,
    seatsFree: z.number().int().min(0).max(20).optional(),
    delta: z.number().int().min(-2).max(2).optional(),
  })
  .refine((v) => (v.seatsFree === undefined) !== (v.delta === undefined));

const commuteLocationPayload = z.object({ tripId: objectId, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const reply = (ack) => (typeof ack === 'function' ? ack : () => {});

export function registerSocketHandlers(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, env.JWT_SECRET);
      const user = await User.findById(payload.sub).select('role status');
      if (!user || user.status !== 'active') return next(new Error('unauthorized'));
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, role } = socket.data;
    socket.join(`user:${userId}`);
    if (role === 'admin') socket.join('admin');

    try {
      if (role === 'driver') {
        const driver = await Driver.findOne({ userId }).select('_id');
        if (driver) {
          socket.data.driverId = String(driver._id);
          const session = await DriverSession.findOne({ driverId: driver._id, active: true }).select('_id');
          if (session) socket.join(`session:${session._id}`);
        }
      } else if (role === 'passenger') {
        const bookings = await Booking.find({ passengerId: userId, active: true }).select('sessionId').lean();
        bookings.forEach((b) => socket.join(`session:${b.sessionId}`));
      }
      const mine = await CommuteBooking.find({ passengerId: userId, active: true }).select('tripId').lean();
      mine.forEach((b) => socket.join(`commute:${b.tripId}`));
      if (role === 'driver') {
        const trips = await CommuteTrip.find({ driverUserId: userId, status: 'in_progress' }).select('_id').lean();
        trips.forEach((t) => socket.join(`commute:${t._id}`));
      }
    } catch (err) {
      logger.error({ err }, 'socket connect setup failed');
    }

    socket.on('route:join', async (routeId, ack) => {
      const parsed = objectId.safeParse(routeId);
      if (!parsed.success) return reply(ack)({ ok: false, error: 'Invalid route id' });
      const exists = await Route.exists({ _id: parsed.data, active: true });
      if (!exists) return reply(ack)({ ok: false, error: 'Route not found' });
      socket.join(`route:${parsed.data}`);
      reply(ack)({ ok: true });
    });

    socket.on('route:leave', (routeId, ack) => {
      if (typeof routeId === 'string') socket.leave(`route:${routeId}`);
      reply(ack)({ ok: true });
    });

    socket.on('driver:location', async (payload, ack) => {
      try {
        if (role !== 'driver' || !socket.data.driverId) throw new Error('Drivers only');
        const now = Date.now();
        if (socket.data.lastLoc && now - socket.data.lastLoc < LOCATION_MIN_GAP_MS) {
          return reply(ack)({ ok: false, error: 'too_fast' });
        }
        socket.data.lastLoc = now;
        const p = locationPayload.parse(payload);
        await recordLocation({
          sessionId: p.sessionId,
          driverId: socket.data.driverId,
          lat: p.lat,
          lng: p.lng,
          heading: p.heading ?? undefined,
          speed: p.speed ?? undefined,
        });
        reply(ack)({ ok: true });
      } catch (err) {
        reply(ack)({ ok: false, error: err.message });
      }
    });

    socket.on('commute:location', async (payload, ack) => {
      try {
        if (role !== 'driver') throw new Error('Drivers only');
        const now = Date.now();
        if (socket.data.lastCommuteLoc && now - socket.data.lastCommuteLoc < LOCATION_MIN_GAP_MS) {
          return reply(ack)({ ok: false, error: 'too_fast' });
        }
        socket.data.lastCommuteLoc = now;
        const p = commuteLocationPayload.parse(payload);
        await recordCommuteLocation({ userId, tripId: p.tripId, lat: p.lat, lng: p.lng });
        reply(ack)({ ok: true });
      } catch (err) {
        reply(ack)({ ok: false, error: err.message });
      }
    });

    socket.on('driver:seats', async (payload, ack) => {
      try {
        if (role !== 'driver' || !socket.data.driverId) throw new Error('Drivers only');
        const p = seatsPayload.parse(payload);
        const session = await setSeats({ _id: socket.data.driverId }, p.sessionId, {
          seatsFree: p.seatsFree,
          delta: p.delta,
        });
        reply(ack)({ ok: true, seatsFree: session.seatsFree });
      } catch (err) {
        reply(ack)({ ok: false, error: err.message });
      }
    });
  });
}
