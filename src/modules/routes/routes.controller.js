import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { Stop } from './stop.model.js';
import { Route } from './route.model.js';
import { Fare } from './fare.model.js';
import { Booking } from '../bookings/booking.model.js';
import {
  listRoutes,
  getRouteDetail,
  getRouteGeometry,
  getFare,
  generateFares,
  previewFares,
  clearRouteCache,
} from './routes.service.js';
import { listLiveCabs } from '../sessions/sessions.service.js';
import { toPublicCab } from '../sessions/publicCab.js';
import { listMapCabs } from '../sessions/liveCabs.js';
import { recordInterest } from '../demand/demand.service.js'; // FEATURE: DRIVER DEMAND ALERTS

const point = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });

export const publicList = asyncHandler(async (_req, res) => {
  res.json({ routes: await listRoutes() });
});

export const publicDetail = asyncHandler(async (req, res) => {
  res.json({ route: await getRouteDetail(req.params.id) });
});

export const publicFare = asyncHandler(async (req, res) => {
  const g = await getRouteGeometry(req.params.id);
  const from = g.stops.find((s) => s.stopId === req.query.from);
  const to = g.stops.find((s) => s.stopId === req.query.to);
  if (!from || !to || from.order >= to.order) {
    throw new AppError(400, 'Stops must be on the route, in travel order', 'INVALID_STOPS');
  }
  res.json({ amount: await getFare(req.params.id, from.stopId, to.stopId) });
});

export const publicCabs = asyncHandler(async (req, res) => {
  // >>> FEATURE: DRIVER DEMAND ALERTS (start). Remembers that this rider looked for a cab at this stop.
  // Automatic refreshes (auto=1) are ignored so a forgotten open screen does not count as waiting.
  if (req.user?.role === 'passenger' && !req.query.auto) recordInterest(req.user._id, req.params.id, req.query.stopId);
  // <<< FEATURE: DRIVER DEMAND ALERTS (end)
  const cabs = await listLiveCabs(req.params.id, req.query.stopId, req.query.toStopId);
  // Visitors see seats, fare and a rough ETA, but not who is driving, the plate or the exact position.
  res.json({ cabs: req.user ? cabs : cabs.map(toPublicCab), signedIn: Boolean(req.user), passed: cabs.passed || 0 });
});

export const liveCabs = asyncHandler(async (_req, res) => {
  res.json({ cabs: await listMapCabs() });
});

export const adminListStops = asyncHandler(async (_req, res) => {
  res.json({ stops: await Stop.find().sort('name') });
});

export const adminCreateStop = asyncHandler(async (req, res) => {
  const { name, lat, lng, active } = req.body;
  const stop = await Stop.create({ name, location: point(lat, lng), active });
  res.status(201).json({ stop });
});

export const adminUpdateStop = asyncHandler(async (req, res) => {
  const { name, lat, lng, active } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (active !== undefined) patch.active = active;
  if (lat !== undefined && lng !== undefined) patch.location = point(lat, lng);
  const stop = await Stop.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!stop) throw new AppError(404, 'Stop not found', 'NOT_FOUND');
  clearRouteCache();
  res.json({ stop });
});

async function checkStops(stopIds) {
  if (new Set(stopIds).size !== stopIds.length) {
    throw new AppError(400, 'A stop appears twice on the route', 'INVALID_STOPS');
  }
  const count = await Stop.countDocuments({ _id: { $in: stopIds } });
  if (count !== stopIds.length) throw new AppError(400, 'One or more stops do not exist', 'INVALID_STOPS');
}

export const adminListRoutes = asyncHandler(async (_req, res) => {
  res.json({ routes: await Route.find().sort('name') });
});

export const adminCreateRoute = asyncHandler(async (req, res) => {
  const { name, stopIds, path, active } = req.body;
  await checkStops(stopIds);
  const route = await Route.create({
    name,
    active,
    stops: stopIds.map((stopId, i) => ({ stopId, order: i + 1 })),
    ...(path && { path: { type: 'LineString', coordinates: path } }),
  });
  res.status(201).json({ route });
});

export const adminUpdateRoute = asyncHandler(async (req, res) => {
  const { name, stopIds, path, active } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (active !== undefined) patch.active = active;
  if (path) patch.path = { type: 'LineString', coordinates: path };
  if (stopIds) {
    await checkStops(stopIds);
    patch.stops = stopIds.map((stopId, i) => ({ stopId, order: i + 1 }));
  }
  const route = await Route.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!route) throw new AppError(404, 'Route not found', 'NOT_FOUND');
  clearRouteCache();
  res.json({ route });
});

export const adminListFares = asyncHandler(async (req, res) => {
  const filter = req.query.routeId ? { routeId: req.query.routeId } : {};
  res.json({ fares: await Fare.find(filter).limit(500) });
});

export const adminUpsertFare = asyncHandler(async (req, res) => {
  const { routeId, fromStopId, toStopId, amount } = req.body;
  const g = await getRouteGeometry(routeId, { activeOnly: false });
  const from = g.stops.find((s) => s.stopId === fromStopId);
  const to = g.stops.find((s) => s.stopId === toStopId);
  if (!from || !to || from.order >= to.order) {
    throw new AppError(400, 'Stops must be on the route, in travel order', 'INVALID_STOPS');
  }
  const fare = await Fare.findOneAndUpdate(
    { routeId, fromStopId, toStopId },
    { $set: { amount } },
    { upsert: true, new: true }
  );
  res.status(201).json({ fare });
});

export const adminUpdateFare = asyncHandler(async (req, res) => {
  const fare = await Fare.findByIdAndUpdate(req.params.id, { $set: { amount: req.body.amount } }, { new: true });
  if (!fare) throw new AppError(404, 'Fare not found', 'NOT_FOUND');
  res.json({ fare });
});

export const adminDeleteFare = asyncHandler(async (req, res) => {
  await Fare.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
});

export const adminGenerateFares = asyncHandler(async (req, res) => {
  const { routeId, base, perStop, mode, perKm, minFare, roundTo } = req.body;
  res.json({ created: await generateFares(routeId, base, perStop, { mode, perKm, minFare, roundTo }) });
});

export const adminPreviewFares = asyncHandler(async (req, res) => {
  const { routeId, base, perStop, mode, perKm, minFare, roundTo } = req.body;
  res.json(await previewFares(routeId, base, perStop, { mode, perKm, minFare, roundTo }));
});

// Remove a stop for good, but only when no route uses it (otherwise the route would break).
export const adminDeleteStop = asyncHandler(async (req, res) => {
  const onRoute = await Route.findOne({ 'stops.stopId': req.params.id }).select('name').lean();
  if (onRoute) throw new AppError(409, `This stop is on the route "${onRoute.name}". Take it off that route first.`, 'STOP_IN_USE');
  const stop = await Stop.findByIdAndDelete(req.params.id);
  if (!stop) throw new AppError(404, 'Stop not found', 'NOT_FOUND');
  clearRouteCache();
  res.json({ ok: true });
});

// Remove a route and its fares. A route that already has bookings is kept (hide it instead) so past trips and receipts still make sense.
export const adminDeleteRoute = asyncHandler(async (req, res) => {
  if (await Booking.exists({ routeId: req.params.id })) {
    throw new AppError(409, 'This route already has bookings, so it cannot be deleted. Hide it instead.', 'ROUTE_IN_USE');
  }
  const route = await Route.findByIdAndDelete(req.params.id);
  if (!route) throw new AppError(404, 'Route not found', 'NOT_FOUND');
  await Fare.deleteMany({ routeId: req.params.id });
  clearRouteCache();
  res.json({ ok: true });
});