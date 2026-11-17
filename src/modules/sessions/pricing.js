import { STANDARD_SEATS, COMFORT_MAX_MULTIPLIER } from '../../config/constants.js';

export const seatTier = (seatsTotal) => (seatsTotal < STANDARD_SEATS ? 'comfort' : 'standard');

/** The price per seat for a cab that offers seatsTotal seats, given the route's normal fare for the same stops. */
export function tierFare(baseFare, seatsTotal) {
  if (baseFare == null || seatsTotal >= STANDARD_SEATS) return baseFare;
  const raw = (baseFare * STANDARD_SEATS) / Math.max(1, seatsTotal);
  const capped = Math.min(raw, baseFare * COMFORT_MAX_MULTIPLIER);
  return Math.max(baseFare, Math.ceil(capped / 50) * 50);
}
