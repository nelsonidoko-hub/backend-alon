import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/** Returns true if the message was sent (or logged in development), false if it failed. */
export async function sendSms(phone, message) {
  if (!env.TERMII_API_KEY) {
    if (env.NODE_ENV === 'production') {
      logger.error({ phone }, 'TERMII_API_KEY is not set, SMS not sent');
      return false;
    }
    logger.info({ phone, message }, 'SMS (dev, not sent)');
    return true;
  }
  try {
    const res = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone.replace('+', ''),
        from: env.TERMII_SENDER_ID,
        sms: message,
        type: 'plain',
        channel: env.TERMII_CHANNEL,
        api_key: env.TERMII_API_KEY,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'Termii SMS failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Termii SMS request error');
    return false;
  }
}
