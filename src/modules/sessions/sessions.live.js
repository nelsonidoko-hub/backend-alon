import { DriverSession } from './session.model.js';
import { Booking } from '../bookings/booking.model.js';
import { Stop } from '../routes/stop.model.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { processRouteAlerts } from '../alerts/route-alerts.service.js';
import { processDemandAlerts } from '../demand/demand.service.js'; // FEATURE: DRIVER DEMAND ALERTS
import { emitToRoute, emitToSession } from '../../realtime/io.js';
import { haversine } from '../../utils/geo.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { ARRIVING_METERS, CAB_FRESH_MS, LOCATION_DB_WRITE_MS } from '../../config/constants.js';

const cache = new Map();

export const forgetSession = (sessionId) => cache.delete(String(sessionId));

export function getLivePosition(session) {
  const entry = cache.get(String(session._id));
  if (entry?.at && Date.now() - entry.at <= CAB_FRESH_MS) {
    return { lat: entry.lat, lng: entry.lng, heading: entry.heading, speed: entry.speed };
  }
  const c = session.lastLocation?.coordinates;
  if (c?.length === 2) {
    return { lat: c[1], lng: c[0], heading: session.lastHeading, speed: session.lastSpeed };
  }
  return null;
}

export function announceSeats(session) {
  const id = String(session._id);
  const entry = cache.get(id);
  if (entry) entry.seatsFree = session.seatsFree;
  const payload = { sessionId: id, routeId: String(session.routeId), seatsFree: session.seatsFree };
  emitToRoute(session.routeId, 'cab:update', payload);
  emitToSession(id, 'cab:update', payload);
}

export function markOffline(sessionId, routeId) {
  const entry = cache.get(String(sessionId));
  if (entry) entry.lastDbWrite = 0;
  emitToRoute(routeId, 'cab:offline', { sessionId: String(sessionId) });
}

async function processArrivals(session) {
  const c = session.lastLocation?.coordinates;
  if (!c) return;
  const bookings = await Booking.find({ sessionId: session._id, status: 'confirmed' })
    .select('passengerId fromStopId')
    .lean();
  if (!bookings.length) return;
  const stops = await Stop.find({ _id: { $in: [...new Set(bookings.map((b) => String(b.fromStopId)))] } }).lean();
  const byId = new Map(stops.map((s) => [String(s._id), s]));

  for (const b of bookings) {
    const stop = byId.get(String(b.fromStopId));
    if (!stop) continue;
    const d = haversine(
      { lat: c[1], lng: c[0] },
      { lat: stop.location.coordinates[1], lng: stop.location.coordinates[0] }
    );
    if (d > ARRIVING_METERS) continue;
    const updated = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'confirmed' },
      { $set: { status: 'arriving', arrivingAt: new Date() } }
    );
    if (updated) {
      notifyUser(
        b.passengerId,
        'cab:arriving',
        { bookingId: String(b._id), status: 'arriving' },
        {
          title: 'Your cab is almost there',
          body: 'Your Along cab is about 2 minutes away. Get ready at your stop.',
          sms: true,
        }
      );
    }
  }
}

export async function recordLocation({ sessionId, driverId, lat, lng, heading, speed }) {
  const id = String(sessionId);
  let entry = cache.get(id);
  if (!entry) {
    const s = await DriverSession.findOne({ _id: id, driverId, active: true }).select('routeId seatsFree');
    if (!s) throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
    entry = { driverId: String(driverId), routeId: String(s.routeId), seatsFree: s.seatsFree, lastDbWrite: 0 };
    cache.set(id, entry);
  }
  if (entry.driverId !== String(driverId)) throw new AppError(403, 'Not your session', 'FORBIDDEN');

  const now = Date.now();
  Object.assign(entry, { lat, lng, heading, speed, at: now });

  if (now - entry.lastDbWrite >= LOCATION_DB_WRITE_MS) {
    entry.lastDbWrite = now;
    const session = await DriverSession.findOneAndUpdate(
      { _id: id, driverId, active: true },
      {
        $set: {
          online: true,
          lastLocation: { type: 'Point', coordinates: [lng, lat] },
          lastHeading: heading,
          lastSpeed: speed,
          lastSeen: new Date(now),
        },
      },
      { new: true }
    );
    if (!session) {
      cache.delete(id);
      throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
    }
    entry.seatsFree = session.seatsFree;
    processArrivals(session).catch((err) => logger.error({ err }, 'processArrivals failed'));
    processRouteAlerts(session, { lat, lng, heading, speed }).catch((err) => logger.error({ err }, 'processRouteAlerts failed'));
    // >>> FEATURE: DRIVER DEMAND ALERTS (start). Turn off with DEMAND_ALERTS_ENABLED=false
    processDemandAlerts(session, { lat, lng, heading, speed }).catch((err) => logger.error({ err }, 'processDemandAlerts failed'));
    // <<< FEATURE: DRIVER DEMAND ALERTS (end)
  }

  const payload = {
    sessionId: id,
    routeId: entry.routeId,
    location: { lat, lng, heading, speed },
    seatsFree: entry.seatsFree,
    at: new Date(now).toISOString(),
  };
  emitToRoute(entry.routeId, 'cab:update', payload);
  emitToSession(id, 'cab:update', payload);
}
