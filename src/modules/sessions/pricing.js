import { COMFORT_MAX_MULTIPLIER } from '../../config/constants.js';

// A driver registers their own vehicle with however many passenger seats it has, so there is no fixed "standard" number.
// A cab is "standard" when it offers every seat its vehicle has, and "comfort" when the driver offers fewer.
export const seatTier = (seatsTotal, seatsCapacity) => (seatsCapacity && seatsTotal < seatsCapacity ? 'comfort' : 'standard');

/** Price per seat: the route's normal fare is for a full vehicle, so fewer seats means each seat costs capacity/seats times more. */
export function tierFare(baseFare, seatsTotal, seatsCapacity) {
  if (baseFare == null || !seatsCapacity || seatsTotal >= seatsCapacity) return baseFare;
  const raw = (baseFare * seatsCapacity) / Math.max(1, seatsTotal);
  const capped = Math.min(raw, baseFare * COMFORT_MAX_MULTIPLIER);
  return Math.max(baseFare, Math.ceil(capped / 50) * 50);
}
