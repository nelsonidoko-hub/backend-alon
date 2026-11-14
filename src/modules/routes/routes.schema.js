import { z } from 'zod';
import { objectId, lat, lng } from '../../utils/schemas.js';

export const stopSchema = z.object({
  name: z.string().trim().min(2).max(120),
  lat,
  lng,
  active: z.boolean().optional(),
});
export const stopUpdateSchema = stopSchema.partial();

const pathSchema = z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2);

export const routeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  stopIds: z.array(objectId).min(2),
  path: pathSchema.optional(),
  active: z.boolean().optional(),
});
export const routeUpdateSchema = routeSchema.partial();

export const fareSchema = z.object({
  routeId: objectId,
  fromStopId: objectId,
  toStopId: objectId,
  amount: z.number().int().min(0).max(100000),
});
export const fareUpdateSchema = z.object({ amount: z.number().int().min(0).max(100000) });
export const generateFaresSchema = z.object({
  routeId: objectId,
  base: z.number().int().min(0),
  perStop: z.number().int().min(0).default(0),
  mode: z.enum(['stops', 'distance']).default('stops'),
  perKm: z.number().min(0).max(100000).optional(),
  minFare: z.number().int().min(0).max(100000).optional(),
  roundTo: z.number().int().min(1).max(1000).optional(),
}).refine((v) => v.mode !== 'distance' || v.perKm !== undefined, { message: 'perKm is required for distance fares', path: ['perKm'] });

export const fareQuerySchema = z.object({ from: objectId, to: objectId });
export const fareListQuerySchema = z.object({ routeId: objectId.optional() });
export const cabsQuerySchema = z.object({ stopId: objectId, toStopId: objectId.optional(), auto: z.string().max(5).optional() });