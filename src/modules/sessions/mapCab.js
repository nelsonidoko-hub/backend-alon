import { seatTier } from './pricing.js';
// Rider map view of a cab: no driver, plate or exact position.
const round = (n) => Math.round(n * 1000) / 1000; // about 110 m, same for everyone

export function toMapCab(session, pos, routeName) {
  return {
    sessionId: String(session._id),
    routeId: String(session.routeId?._id || session.routeId),
    routeName: routeName || '',
    seatsFree: session.seatsFree,
    seatsTotal: session.seatsTotal,
    tier: seatTier(session.seatsTotal, session.seatsCapacity),
    full: session.seatsFree === 0,
    location: { lat: round(pos.lat), lng: round(pos.lng) },
  };
}

