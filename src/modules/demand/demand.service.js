// ======================================================================================
// FEATURE: DRIVER DEMAND ALERTS
//
// Tells drivers how many riders are looking for a cab at the stops ahead of them:
//   1. In the driver's "Waiting ahead" list (booked riders, plus a "looking" count).
//   2. As a notification when 2 or more riders are looking at a stop the driver is about to reach.
//
// "Looking" means a rider opened the cab list for that stop in the last 10 minutes and has not booked.
// Only counts are ever shared, never who the riders are.
//
// TO SWITCH THIS OFF: set DEMAND_ALERTS_ENABLED=false in .env and restart. Nothing is recorded,
// no alerts are sent, and the "looking" counts disappear.
// Everything for this feature is marked "FEATURE: DRIVER DEMAND ALERTS" so you can search for it.
// ======================================================================================
import { env } from '../../config/env.js';
import { Booking } from '../bookings/booking.model.js';
import { Driver } from '../drivers/driver.model.js';
import { getRouteGeometry } from '../routes/routes.service.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { project, etaSeconds } from '../../utils/geo.js';
import { createInterestStore } from './interest-store.js';

const ALERT_ETA_SECONDS = 10 * 60;
const COOLDOWN_MS = 15 * 60 * 1000;

export const demandEnabled = () => env.DEMAND_ALERTS_ENABLED === 'true';

const store = createInterestStore();
const lastAlert = new Map();

export function recordInterest(userId, routeId, stopId) {
  if (!demandEnabled()) return;
  store.record(String(userId), String(routeId), String(stopId));
}

/** Map(stopId -> number of riders looking), not counting riders who already booked. */
export async function lookingByStop(routeId) {
  const out = new Map();
  if (!demandEnabled()) return out;
  const byStop = store.activeByStop(String(routeId));
  if (!byStop.size) return out;
  const everyone = [...new Set([...byStop.values()].flat())];
  const booked = new Set(
    (await Booking.find({ passengerId: { $in: everyone }, active: true }).select('passengerId').lean()).map((b) =>
      String(b.passengerId)
    )
  );
  for (const [stopId, ids] of byStop) {
    const n = ids.filter((id) => !booked.has(id)).length;
    if (n > 0) out.set(stopId, n);
  }
  return out;
}

/** Called when a cab's position is saved. Alerts the driver about the nearest busy stop ahead. */
export async function processDemandAlerts(session, pos) {
  if (!demandEnabled() || !pos || session.seatsFree < 1) return;
  const looking = await lookingByStop(session.routeId);
  if (!looking.size) return;

  const g = await getRouteGeometry(session.routeId);
  const progress = project(g.path, pos).distAlong;
  let best = null;
  for (const s of g.stops) {
    const n = looking.get(s.stopId) || 0;
    if (n < env.DEMAND_ALERT_MIN_RIDERS) continue;
    const remaining = s.distAlong - progress;
    if (remaining < 0 || etaSeconds(remaining, pos.speed) > ALERT_ETA_SECONDS) continue;
    if (!best || remaining < best.remaining) best = { stop: s, n, remaining };
  }
  if (!best) return;

  const key = `${session._id}:${best.stop.stopId}`;
  if (Date.now() - (lastAlert.get(key) || 0) < COOLDOWN_MS) return;
  if (lastAlert.size > 2000) lastAlert.clear();
  lastAlert.set(key, Date.now());

  const driver = await Driver.findById(session.driverId).select('userId').lean();
  if (!driver) return;
  const minutes = Math.max(1, Math.round(etaSeconds(best.remaining, pos.speed) / 60));
  notifyUser(
    driver.userId,
    'demand:alert',
    { stopId: best.stop.stopId, looking: best.n },
    {
      type: 'demand_alert',
      title: `${best.n} riders are looking for a cab at ${best.stop.name}`,
      body: `About ${minutes} min ahead. They have not booked yet. Riders who booked are listed first in your app.`,
      url: '/drive',
    }
  );
}
// ================= END FEATURE: DRIVER DEMAND ALERTS =================
