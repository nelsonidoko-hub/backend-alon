import { Booking } from '../bookings/booking.model.js';
import { CommuteBooking, CommuteTrip } from '../commute/commute.models.js';
import { Driver } from '../drivers/driver.model.js';
import { LedgerEntry } from '../wallet/wallet.models.js';
import { getRouteGeometry } from '../routes/routes.service.js';
import { AppError } from '../../utils/AppError.js';

const number = (prefix, id) => `${prefix}-${String(id).slice(-8).toUpperCase()}`;
const first = (n) => (n ? String(n).split(/\s+/)[0] : '');
const mine = (id) => ({ $or: [{ passengerId: id }, { driverUserId: id }] });

/** What the driver actually received for each wallet-paid trip, taken from the ledger. */
async function netFor(kind, docs) {
  const refs = docs.filter((d) => d.paymentMethod === 'wallet' && d.heldKobo > 0).map((d) => `settle:${kind}:${d._id}:driver`);
  const rows = refs.length ? await LedgerEntry.find({ ref: { $in: refs } }).select('ref amount').lean() : [];
  const byRef = new Map(rows.map((r) => [r.ref, r.amount]));
  return (d, grossKobo) => {
    if (d.paymentMethod !== 'wallet' || !d.heldKobo) return { net: grossKobo, commission: 0 };
    const net = byRef.get(`settle:${kind}:${d._id}:driver`);
    return net == null ? { net: grossKobo, commission: 0 } : { net, commission: grossKobo - net };
  };
}

export async function rideReceipt(user, id) {
  const b = await Booking.findOne({ _id: id, ...mine(user._id) })
    .populate('passengerId', 'name')
    .lean();
  if (!b) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  if (b.status !== 'completed') throw new AppError(409, 'A receipt is available once the trip is completed', 'NOT_COMPLETED');
  const g = await getRouteGeometry(b.routeId, { activeOnly: false });
  const names = new Map(g.stops.map((s) => [s.stopId, s.name]));
  const driver = await Driver.findById(b.driverId).populate('userId', 'name').populate('vehicleId', 'plate make model colour').lean();
  const viewerIsDriver = String(b.driverUserId) === String(user._id);
  const gross = b.fare * 100;
  const split = (await netFor('ride', [b]))(b, gross);
  return {
    kind: 'ride',
    viewer: viewerIsDriver ? 'driver' : 'rider',
    number: number('AL', b._id),
    date: b.completedAt || b.updatedAt,
    route: g.route.name,
    from: names.get(String(b.fromStopId)),
    to: names.get(String(b.toStopId)),
    seats: b.seats,
    totalKobo: gross,
    paymentMethod: b.paymentMethod,
    rider: first(b.passengerId?.name),
    driver: first(driver?.userId?.name),
    vehicle: driver?.vehicleId ? `${driver.vehicleId.colour} ${driver.vehicleId.make} ${driver.vehicleId.model}, ${driver.vehicleId.plate}` : null,
    ...(viewerIsDriver && { commissionKobo: split.commission, netKobo: split.net }),
  };
}

export async function commuteReceipt(user, id) {
  const b = await CommuteBooking.findOne({ _id: id, ...mine(user._id) }).populate('passengerId', 'name').lean();
  if (!b) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  if (b.status !== 'completed') throw new AppError(409, 'A receipt is available once the trip is completed', 'NOT_COMPLETED');
  const trip = await CommuteTrip.findById(b.tripId).lean();
  const driver = await Driver.findById(trip?.driverId).populate('userId', 'name').populate('vehicleId', 'plate make model colour').lean();
  const viewerIsDriver = String(b.driverUserId) === String(user._id);
  const gross = (b.pricePerSeat || 0) * 100 * (b.seats || 1);
  const split = (await netFor('commute', [b]))(b, gross);
  return {
    kind: 'commute',
    viewer: viewerIsDriver ? 'driver' : 'rider',
    number: number('AC', b._id),
    date: b.completedAt || b.updatedAt,
    route: trip ? `${trip.origin?.name} to ${trip.destination?.name}` : 'Staff carpool',
    from: trip?.origin?.name,
    to: trip?.destination?.name,
    seats: b.seats,
    totalKobo: gross,
    paymentMethod: b.paymentMethod,
    rider: first(b.passengerId?.name),
    driver: first(driver?.userId?.name),
    vehicle: driver?.vehicleId ? `${driver.vehicleId.colour} ${driver.vehicleId.make} ${driver.vehicleId.model}, ${driver.vehicleId.plate}` : null,
    ...(viewerIsDriver && { commissionKobo: split.commission, netKobo: split.net }),
  };
}

/** A driver's earnings between two dates: every completed trip, with FoloRide's fee and what they kept. */
export async function driverStatement(user, from, to) {
  const range = { $gte: from, $lte: to };
  const [rides, commute] = await Promise.all([
    Booking.find({ driverUserId: user._id, status: 'completed', completedAt: range }).sort('completedAt').limit(500).lean(),
    CommuteBooking.find({ driverUserId: user._id, status: 'completed', completedAt: range }).sort('completedAt').limit(500).lean(),
  ]);
  const rideNet = await netFor('ride', rides);
  const commuteNet = await netFor('commute', commute);
  const lines = [
    ...rides.map((b) => {
      const gross = b.fare * 100;
      return { number: number('AL', b._id), date: b.completedAt, kind: 'ride', paymentMethod: b.paymentMethod, grossKobo: gross, ...rideNet(b, gross) };
    }),
    ...commute.map((b) => {
      const gross = (b.pricePerSeat || 0) * 100 * (b.seats || 1);
      return { number: number('AC', b._id), date: b.completedAt, kind: 'commute', paymentMethod: b.paymentMethod, grossKobo: gross, ...commuteNet(b, gross) };
    }),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  const sum = (f) => lines.reduce((t, l) => t + f(l), 0);
  return {
    from,
    to,
    lines,
    totals: {
      trips: lines.length,
      grossKobo: sum((l) => l.grossKobo),
      commissionKobo: sum((l) => l.commission),
      netKobo: sum((l) => l.net),
      cashKobo: sum((l) => (l.paymentMethod === 'wallet' ? 0 : l.grossKobo)),
      walletKobo: sum((l) => (l.paymentMethod === 'wallet' ? l.net : 0)),
    },
  };
}
