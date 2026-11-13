import { z } from 'zod';

const url = z.string().max(300).optional();

export const applySchema = z.object({
  driverType: z.enum(['taxi', 'staff']).default('taxi'),
  licenceNumber: z.string().trim().min(3).max(40),
  licencePhotoKey: url,
  idPhotoKey: url,
  vehiclePapersKey: url,
  profilePhotoKey: url,
  vehicle: z.object({
    plate: z.string().trim().min(3).max(15),
    make: z.string().trim().min(2).max(40),
    model: z.string().trim().min(1).max(40),
    colour: z.string().trim().min(2).max(30),
    year: z.number().int().min(1990).max(2100).optional(),
    seatCapacity: z.number().int().min(1).max(8),
  }),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const driverListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'suspended']).optional(),
});
