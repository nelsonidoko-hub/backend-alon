import { z } from 'zod';
import { objectId, lat, lng } from '../../utils/schemas.js';

export const startSessionSchema = z.object({
  routeId: objectId,
  lat: lat.optional(),
  lng: lng.optional(),
  allowDrop: z.boolean().optional(), // accept whole-cab bookings (default yes)
  seats: z.number().int().min(1).max(60).optional(), // passenger seats to offer; fewer than the vehicle has = comfort ride
});

export const seatsSchema = z
  .object({
    seatsFree: z.number().int().min(0).max(20).optional(),
    delta: z.number().int().min(-2).max(2).optional(),
  })
  .refine((v) => (v.seatsFree === undefined) !== (v.delta === undefined), {
    message: 'Send either seatsFree or delta',
  });

export const locationSchema = z.object({
  lat,
  lng,
  heading: z.number().min(0).max(360).nullish(),
  speed: z.number().min(0).max(80).nullish(),
});
