import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  OTP_SECRET: z.string().min(16),
  // Allowed app origins, comma separated: the rider, driver and admin apps.
  CLIENT_URL: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175'),
  // Where links to the rider app and the driver app point. They default to the first and second CLIENT_URL.
  RIDER_URL: z.string().optional(),
  DRIVER_URL: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(180),
  // Social sign-in (optional). A button only works once its keys are set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  OTP_TTL_MINUTES: z.coerce.number().default(5),
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
  // SMS: 'auto' uses whichever provider has a key (Infobip first). Set to 'termii' later to make Termii the main one.
  SMS_PROVIDER: z.enum(['auto', 'infobip', 'termii']).default('auto'),
  INFOBIP_API_KEY: z.string().optional(),
  INFOBIP_BASE_URL: z.string().optional(), // your own address from the Infobip portal, e.g. xxxxx.api.infobip.com
  INFOBIP_SENDER_ID: z.string().default('InfoSMS'),
  TERMII_API_KEY: z.string().optional(),
  TERMII_SENDER_ID: z.string().default('FoloRide'),
  TERMII_CHANNEL: z.enum(['generic', 'dnd', 'whatsapp']).default('generic'),
  TERMII_BASE_URL: z.string().default('https://api.ng.termii.com'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  // Testing only: with no SMS key, print sign-in codes in the server log instead of failing. Turn off before real users.
  LOG_OTP_WITHOUT_SMS: z.enum(['true', 'false']).default('false'),
  DEMAND_ALERTS_ENABLED: z.enum(['true', 'false']).default('true'),
  DEMAND_ALERT_MIN_RIDERS: z.coerce.number().int().min(1).default(2),
  WHATSAPP_ENABLED: z.enum(['true', 'false']).default('false'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v23.0'),
  WHATSAPP_BUSINESS_NUMBER: z.string().optional(),
  WHATSAPP_UPDATE_TEMPLATE: z.string().optional(),
  WHATSAPP_OTP_TEMPLATE: z.string().optional(),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),
  OTP_CHANNEL: z.enum(['sms', 'whatsapp']).default('sms'),
  TERMS_URL: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_BASE_URL: z.string().default('https://api.paystack.co'),
  COMMISSION_PERCENT: z.coerce.number().min(0).max(50).default(10),
  COMMUTE_COMMISSION_PERCENT: z.coerce.number().min(0).max(50).default(0),
  NO_SHOW_FEE_PERCENT: z.coerce.number().min(0).max(100).default(0),
  WITHDRAWAL_MODE: z.enum(['manual', 'auto']).default('manual'),
  MIN_WITHDRAWAL_KOBO: z.coerce.number().default(100000),
  WITHDRAWAL_FEE_KOBO: z.coerce.number().default(0),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
const trimSlash = (s) => s.trim().replace(/\/$/, '');
export const clientOrigins = env.CLIENT_URL.split(',').map(trimSlash).filter(Boolean);
const firstOrigin = clientOrigins[0] || 'http://localhost:5173';
export const riderUrl = trimSlash(env.RIDER_URL || firstOrigin);
export const driverUrl = trimSlash(env.DRIVER_URL || clientOrigins[1] || firstOrigin);
