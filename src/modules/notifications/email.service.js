import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// Sends one plain email through Brevo or Resend (both over HTTPS, so it works on Render's free plan, which blocks SMTP).
//   EMAIL_PROVIDER=brevo | resend, EMAIL_API_KEY=..., EMAIL_FROM=an address the provider has verified, EMAIL_FROM_NAME=FoloRide
// Returns true when the provider accepted the message. Never throws.
export async function sendEmail(to, subject, text) {
  const testMode = env.NODE_ENV === 'production' && env.LOG_OTP_WITHOUT_SMS === 'true';
  if (testMode) logger.warn({ to, subject, text }, 'TEST MODE: email (also sent if an email provider is set up)');
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    if (testMode) return true;
    logger.error('No email provider configured (set EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM), email not sent');
    return false;
  }
  const name = env.EMAIL_FROM_NAME || 'FoloRide';
  try {
    let res;
    if ((env.EMAIL_PROVIDER || 'brevo') === 'resend') {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${name} <${env.EMAIL_FROM}>`, to: [to], subject, text }),
        signal: AbortSignal.timeout(10000),
      });
    } else {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.EMAIL_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { name, email: env.EMAIL_FROM }, to: [{ email: to }], subject, textContent: text }),
        signal: AbortSignal.timeout(10000),
      });
    }
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'Email send failed');
      return testMode;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Email request error');
    return testMode;
  }
}
