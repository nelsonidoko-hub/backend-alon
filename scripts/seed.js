// Seeds a sample route. COORDINATES ARE PLACEHOLDERS: replace them with surveyed stop locations.
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Stop } from '../src/modules/routes/stop.model.js';
import { Route } from '../src/modules/routes/route.model.js';
import { generateFares } from '../src/modules/routes/routes.service.js';

const STOPS = [
  ['Nyanya Park', 9.017, 7.586],
  ['AYA Junction', 9.0238, 7.539],
  ['Mabushi', 9.0555, 7.4701],
  ['Jabi Park', 9.0713, 7.4331],
  ['Berger Roundabout', 9.0635, 7.4859],
];

await connectDb();

const docs = [];
for (const [name, lat, lng] of STOPS) {
  const stop = await Stop.findOneAndUpdate(
    { name },
    { $set: { name, location: { type: 'Point', coordinates: [lng, lat] }, active: true } },
    { upsert: true, new: true }
  );
  docs.push(stop);
}

async function upsertRoute(name, stops) {
  return Route.findOneAndUpdate(
    { name },
    { $set: { name, active: true, stops: stops.map((s, i) => ({ stopId: s._id, order: i + 1 })) } },
    { upsert: true, new: true }
  );
}

const forward = await upsertRoute('Nyanya to Berger', docs);
const reverse = await upsertRoute('Berger to Nyanya', [...docs].reverse());
const a = await generateFares(forward._id, 300, 100);
const b = await generateFares(reverse._id, 300, 100);

console.log(`Seeded ${docs.length} stops, 2 routes, ${a + b} fares (placeholder prices and coordinates).`);
await disconnectDb();
