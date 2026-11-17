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

export const requestOtpSchema = z.object({ phone });
const emailField = z.string().trim().toLowerCase().email().max(120);
export const requestEmailOtpSchema = z.object({ email: emailField, role: z.enum(['passenger', 'driver']).optional() });
export const verifyEmailOtpSchema = z.object({
  email: emailField,
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['passenger', 'driver']).optional(),
});

export const verifyOtpSchema = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['passenger', 'driver']).optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export const socialSchema = z.object({
  provider: z.enum(['google', 'facebook']),
  token: z.string().min(10).max(4000),
  role: z.enum(['passenger', 'driver']).optional(),
});

export const socialPhoneSchema = z.object({
  signupToken: z.string().min(20).max(4000),
  phone,
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});
