import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// Providers. Each returns true when the provider accepted the message, false otherwise (never throws).
async function sendViaInfobip(phone, message) {
  try {
    const base = env.INFOBIP_BASE_URL.startsWith('http') ? env.INFOBIP_BASE_URL : `https://${env.INFOBIP_BASE_URL}`;
    const res = await fetch(`${base.replace(/\/+$/, '')}/sms/2/text/advanced`, {
      method: 'POST',
      headers: {
        Authorization: `App ${env.INFOBIP_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        messages: [{ destinations: [{ to: phone.replace('+', '') }], from: env.INFOBIP_SENDER_ID, text: message }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.error({ status: res.status, body: JSON.stringify(data).slice(0, 300) }, 'Infobip SMS failed');
      return false;
    }
    // Infobip answers 200 even when it refuses one message; the per-message status says so.
    const st = data.messages?.[0]?.status;
    if (st && (st.groupName === 'REJECTED' || st.groupName === 'UNDELIVERABLE')) {
      logger.error({ status: st.name, description: st.description }, 'Infobip SMS rejected');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Infobip SMS request error');
    return false;
  }
}

// Termii "Number API": sends from an auto-generated number, so no approved Sender ID is needed.
async function sendViaTermiiNumber(phone, message) {
  try {
    const res = await fetch(`${env.TERMII_BASE_URL}${env.TERMII_NUMBER_PATH || '/api/sms/number/send'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone.replace('+', ''), sms: message, api_key: env.TERMII_API_KEY }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'Termii Number API SMS failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Termii Number API request error');
    return false;
  }
}

async function sendViaTermii(phone, message) {
  // TERMII_NUMBER_API=true: always use the Number API (use this while the Sender ID is still pending).
  if (env.TERMII_NUMBER_API === 'true') return sendViaTermiiNumber(phone, message);
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
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body }, 'Termii SMS failed');
      // Sender ID not approved yet: try the Number API instead.
      if (/sender/i.test(body)) return sendViaTermiiNumber(phone, message);
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Termii SMS request error');
    return false;
  }
}

const PROVIDERS = {
  infobip: { configured: () => Boolean(env.INFOBIP_API_KEY && env.INFOBIP_BASE_URL), send: sendViaInfobip },
  termii: { configured: () => Boolean(env.TERMII_API_KEY), send: sendViaTermii },
};

// SMS_PROVIDER=infobip | termii picks the main one. 'auto' (default) uses whichever has a key, Infobip first.
// If the main provider fails and the other one is configured, the other is tried once.
function order() {
  const names = Object.keys(PROVIDERS);
  const first = env.SMS_PROVIDER === 'auto' ? names.find((n) => PROVIDERS[n].configured()) : env.SMS_PROVIDER;
  if (!first) return [];
  return [first, ...names.filter((n) => n !== first)].filter((n) => PROVIDERS[n].configured());
}

/** Returns true if the message was sent (or logged in development), false if it failed. */
export async function sendSms(phone, message) {
  const testMode = env.NODE_ENV === 'production' && env.LOG_OTP_WITHOUT_SMS === 'true';
  // Testing only: always show the message in the server log, whether or not the SMS then goes through.
  if (testMode) logger.warn({ phone, message }, 'TEST MODE: message (also sent by SMS if a provider is set up)');
  const chain = order();
  if (!chain.length) {
    if (testMode) return true;
    if (env.NODE_ENV === 'production') {
      logger.error({ phone }, 'No SMS provider configured (set INFOBIP_API_KEY or TERMII_API_KEY), SMS not sent');
      return false;
    }
    logger.info({ phone, message }, 'SMS (dev, not sent)');
    return true;
  }
  for (const name of chain) {
    if (await PROVIDERS[name].send(phone, message)) return true;
    logger.warn({ provider: name }, chain.length > 1 ? 'SMS provider failed, trying the next one' : 'SMS provider failed');
  }
  // In test mode a failed SMS still counts as success, because the code is in the log. Remove LOG_OTP_WITHOUT_SMS before real users.
  return testMode;
}