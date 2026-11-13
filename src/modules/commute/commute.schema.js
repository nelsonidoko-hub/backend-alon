import { z } from 'zod';
import { objectId, lat, lng } from '../../utils/schemas.js';

const direction = z.enum(['to_work', 'from_work']);
const home = z.object({ name: z.string().trim().max(80).optional(), lat, lng });
const waypoints = z.array(z.object({ lat, lng })).max(10).default([]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 hour)');
const shared = {
  home,
  waypoints,
  seatsTotal: z.number().int().min(1).max(8).optional(),
  pricePerSeat: z.number().int().min(0).default(0),
  durationMinutes: z.number().int().min(5).max(240).default(30),
  maxDetourMeters: z.number().int().min(200).max(3000).default(1000),
};

export const scheduleSchema = z.object({
  ...shared,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  trips: z.array(z.object({ direction, timeOfDay: time })).min(1).max(2),
});
export const tripSchema = z.object({ ...shared, direction, departAt: z.coerce.date() });
export const searchQuery = z.object({
  direction,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lat,
  lng,
});
export const bookSchema = z.object({
  tripId: objectId,
  lat,
  lng,
  label: z.string().trim().max(80).optional(),
  paymentMethod: z.enum(['cash', 'wallet']).default('cash'),
});
export const codeSchema = z.object({ code: z.string().regex(/^\d{4}$/, 'Code must be 4 digits') });
export const locationSchema = z.object({ lat, lng });
export const reasonSchema = z.object({ reason: z.string().trim().max(200).optional() });
export const adminTripQuery = z.object({
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled', 'expired']).optional(),
  orgId: objectId.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
