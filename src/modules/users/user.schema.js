import { z } from 'zod';
import { normalizePhone } from '../../utils/phone.js';

const phone = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Invalid Nigerian phone number' });
    return z.NEVER;
  }
  return p;
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  emergencyContact: z.object({ name: z.string().trim().min(2).max(80), phone }).optional(),
  notificationPrefs: z.object({ sms: z.boolean(), whatsapp: z.boolean().optional() }).optional(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export const phoneRequestSchema = z.object({ phone });
export const phoneConfirmSchema = z.object({ phone, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });