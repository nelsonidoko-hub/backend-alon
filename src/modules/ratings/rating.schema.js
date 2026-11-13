import { z } from 'zod';

export const ratingSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(300).optional(),
});
