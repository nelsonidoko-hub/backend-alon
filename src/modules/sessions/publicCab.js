// The cab details a visitor without an account may see.
// Left out on purpose: driver name and photo, vehicle plate, heading, and the exact position.
const roundCoord = (n) => Math.round(n * 1000) / 1000; // about 110 m
const roundDistance = (m) => Math.round(m / 50) * 50;

export function toPublicCab(c) {
  return {
    sessionId: c.sessionId,
    seatsFree: c.seatsFree,
    seatsTotal: c.seatsTotal,
    tier: c.tier,
    full: c.full,
    distanceMeters: roundDistance(c.distanceMeters),
    etaSeconds: c.etaSeconds,
    location: { lat: roundCoord(c.location.lat), lng: roundCoord(c.location.lng) },
    driver: null,
    vehicle: null,
    fare: c.fare,
  };
}
