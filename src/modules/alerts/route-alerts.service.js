import { RouteAlert } from './route-alert.model.js';
import { Booking } from '../bookings/booking.model.js';
import { Notification } from '../notifications/notification.model.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { getRouteGeometry } from '../routes/routes.service.js';
import { project, etaSeconds } from '../../utils/geo.js';
import { AppError } from '../../utils/AppError.js';

const ALERT_ETA_SECONDS = 15 * 60;
const COOLDOWN_MS = 30 * 60 * 1000;
const DAILY_CAP = 8;
const MAX_ALERTS_PER_USER = 5;
const CACHE_MS = 60 * 1000;

const cache = new Map();
export const clearAlertCache = (routeId) => (routeId ? cache.delete(String(routeId)) : cache.clear());

async function alertsForRoute(routeId) {
  const key = String(routeId);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.alerts;
  const alerts = await RouteAlert.find({ routeId, active: true }).lean();
  cache.set(key, { alerts, expires: Date.now() + CACHE_MS });
  return alerts;
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function lagosNow() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return { weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Called when a cab's position is saved. Tells subscribers whose stop is ahead of the cab and close. */
export async function processRouteAlerts(session, pos) {
  if (!pos || session.seatsFree < 1) return;
  const alerts = await alertsForRoute(session.routeId);
  if (!alerts.length) return;

  const g = await getRouteGeometry(session.routeId);
  const stops = new Map(g.stops.map((s) => [s.stopId, s]));
  const progress = project(g.path, pos).distAlong;
  const now = lagosNow();

  for (const a of alerts) {
    if (a.lastSentAt && Date.now() - new Date(a.lastSentAt).getTime() < COOLDOWN_MS) continue;
    if (!a.days.includes(now.weekday)) continue;
    if (now.minutes < toMinutes(a.startTime) || now.minutes > toMinutes(a.endTime)) continue;
    const stop = stops.get(String(a.fromStopId));
    if (!stop) continue;
    const remaining = stop.distAlong - progress;
    if (remaining < 0) continue;
    const eta = etaSeconds(remaining, pos.speed);
    if (eta > ALERT_ETA_SECONDS) continue;

    const claimed = await RouteAlert.findOneAndUpdate(
      { _id: a._id, active: true, $or: [{ lastSentAt: null }, { lastSentAt: { $lt: new Date(Date.now() - COOLDOWN_MS) } }] },
      { $set: { lastSentAt: new Date() } }
    );
    a.lastSentAt = new Date();
    if (!claimed) continue;

    if (await Booking.exists({ passengerId: a.userId, active: true })) continue;
    const today = await Notification.countDocuments({
      userId: a.userId,
      type: 'route_alert',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (today >= DAILY_CAP) continue;

    const minutes = Math.max(1, Math.round(eta / 60));
    notifyUser(
      a.userId,
      'route:alert',
      { routeId: String(session.routeId), stopId: stop.stopId, sessionId: String(session._id), etaSeconds: eta, seatsFree: session.seatsFree },
      {
        type: 'route_alert',
        title: `A cab is near ${stop.name}`,
        body: `A cab on ${g.route.name} is about ${minutes} min from ${stop.name}. ${session.seatsFree} seat${session.seatsFree === 1 ? '' : 's'} free. Tap to book.`,
        url: '/ride',
        whatsapp: true, // FEATURE: WHATSAPP
      }
    );
  }
}

export async function listAlerts(userId) {
  const alerts = await RouteAlert.find({ userId }).sort('-createdAt').lean();
  const out = [];
  for (const a of alerts) {
    let routeName = 'Route';
    let stopName = 'Stop';
    try {
      const g = await getRouteGeometry(a.routeId, { activeOnly: false });
      routeName = g.route.name;
      stopName = g.stops.find((s) => s.stopId === String(a.fromStopId))?.name || stopName;
    } catch {
      /* route removed */
    }
    out.push({ ...a, routeName, stopName });
  }
  return out;
}

export async function createAlert(user, { routeId, fromStopId, days, startTime, endTime }) {
  if ((await RouteAlert.countDocuments({ userId: user._id })) >= MAX_ALERTS_PER_USER) {
    throw new AppError(409, `You can have up to ${MAX_ALERTS_PER_USER} route alerts`, 'TOO_MANY_ALERTS');
  }
  if (toMinutes(startTime) >= toMinutes(endTime)) {
    throw new AppError(400, 'The start time must be before the end time', 'INVALID_TIME');
  }
  const g = await getRouteGeometry(routeId);
  const idx = g.stops.findIndex((s) => s.stopId === fromStopId);
  if (idx < 0 || idx === g.stops.length - 1) {
    throw new AppError(400, 'Choose a stop on this route where you can get on', 'INVALID_STOPS');
  }
  const alert = await RouteAlert.create({ userId: user._id, routeId, fromStopId, days: [...new Set(days)], startTime, endTime });
  clearAlertCache(routeId);
  return alert;
}

export async function updateAlert(userId, id, patch) {
  const current = await RouteAlert.findOne({ _id: id, userId });
  if (!current) throw new AppError(404, 'Alert not found', 'NOT_FOUND');
  const next = { ...current.toObject(), ...patch };
  if (toMinutes(next.startTime) >= toMinutes(next.endTime)) {
    throw new AppError(400, 'The start time must be before the end time', 'INVALID_TIME');
  }
  if (patch.days) patch.days = [...new Set(patch.days)];
  Object.assign(current, patch);
  await current.save();
  clearAlertCache(current.routeId);
  return current;
}

export async function deleteAlert(userId, id) {
  const a = await RouteAlert.findOneAndDelete({ _id: id, userId });
  if (!a) throw new AppError(404, 'Alert not found', 'NOT_FOUND');
  clearAlertCache(a.routeId);
}
