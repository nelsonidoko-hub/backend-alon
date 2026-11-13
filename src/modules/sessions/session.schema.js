import { z } from 'zod';
import { objectId, lat, lng } from '../../utils/schemas.js';

export const startSessionSchema = z.object({
  routeId: objectId,
  lat: lat.optional(),
  lng: lng.optional(),
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
