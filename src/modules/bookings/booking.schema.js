import { z } from 'zod';
import { objectId } from '../../utils/schemas.js';
import { MAX_SEATS_PER_BOOKING } from '../../config/constants.js';

export const createBookingSchema = z.object({
  sessionId: objectId,
  fromStopId: objectId,
  toStopId: objectId,
  seats: z.number().int().min(1).max(MAX_SEATS_PER_BOOKING).default(1),
  drop: z.boolean().default(false), // book the whole cab
  paymentMethod: z.enum(['cash', 'transfer', 'wallet']).default('cash'),
});

export const cancelSchema = z.object({ reason: z.string().trim().max(200).optional() });
export const driverCancelSchema = z.object({ reason: z.enum(['cant_reach', 'vehicle_problem', 'rider_asked', 'other']).default('other') });
export const pickupSchema = z.object({ code: z.string().regex(/^\d{4}$/, 'Code must be 4 digits') });
export const completeSchema = z.object({ paymentConfirmed: z.boolean().default(true) });
export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const tokenParams = z.object({ token: z.string().min(20).max(100) });
