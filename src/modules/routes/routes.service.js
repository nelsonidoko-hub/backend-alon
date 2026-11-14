import { Stop } from './stop.model.js';
import { Route } from './route.model.js';
import { Fare } from './fare.model.js';
import { AppError } from '../../utils/AppError.js';
import { buildPath, project } from '../../utils/geo.js';

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

export const clearRouteCache = () => cache.clear();

export async function getRouteGeometry(routeId, { activeOnly = true } = {}) {
  const key = `${routeId}:${activeOnly}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const route = await Route.findById(routeId).lean();
  if (!route || (activeOnly && !route.active)) {
    throw new AppError(404, 'Route not found', 'ROUTE_NOT_FOUND');
  }
  const ordered = [...route.stops].sort((a, b) => a.order - b.order);
  const docs = await Stop.find({ _id: { $in: ordered.map((s) => s.stopId) } }).lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const stops = ordered.map((s) => {
    const d = byId.get(String(s.stopId));
    if (!d) throw new AppError(500, 'Route has a missing stop', 'ROUTE_BROKEN');
    return {
      stopId: String(s.stopId),
      name: d.name,
      order: s.order,
      location: { lat: d.location.coordinates[1], lng: d.location.coordinates[0] },
    };
  });

  const points =
    route.path?.coordinates?.length >= 2
      ? route.path.coordinates.map(([lng, lat]) => ({ lat, lng }))
      : stops.map((s) => s.location);
  const path = buildPath(points);
  for (const s of stops) s.distAlong = project(path, s.location).distAlong;

  const value = { route: { id: String(route._id), name: route.name, active: route.active }, stops, path };
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function listRoutes() {
  const routes = await Route.find({ active: true }).select('name stops').sort('name').lean();
  return routes.map((r) => ({ id: String(r._id), name: r.name, stopCount: r.stops.length }));
}

export async function getRouteDetail(routeId) {
  const g = await getRouteGeometry(routeId);
  return {
    id: g.route.id,
    name: g.route.name,
    stops: g.stops.map((s) => ({
      id: s.stopId,
      name: s.name,
      order: s.order,
      lat: s.location.lat,
      lng: s.location.lng,
    })),
    path: g.path.points.map((p) => [p.lng, p.lat]),
  };
}

export async function getFare(routeId, fromStopId, toStopId) {
  const fare = await Fare.findOne({ routeId, fromStopId, toStopId }).lean();
  if (!fare) throw new AppError(404, 'No fare set for these stops', 'FARE_NOT_FOUND');
  return fare.amount;
}

export async function generateFares(routeId, base, perStop, opts = {}) {
  const g = await getRouteGeometry(routeId, { activeOnly: false });
  const ops = [];
  for (let i = 0; i < g.stops.length; i++) {
    for (let j = i + 1; j < g.stops.length; j++) {
      let amount;
      if (opts.mode === 'distance') {
        const km = (g.stops[j].distAlong - g.stops[i].distAlong) / 1000;
        const step = opts.roundTo || 50;
        amount = Math.max(opts.minFare || 0, Math.round((base + opts.perKm * km) / step) * step);
      } else {
        const raw = base + perStop * (j - i - 1);
        amount = Math.round(raw / 10) * 10;
      }
      ops.push({
        updateOne: {
          filter: { routeId, fromStopId: g.stops[i].stopId, toStopId: g.stops[j].stopId },
          update: { $set: { amount } },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await Fare.bulkWrite(ops);
  return ops.length;
}