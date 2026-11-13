// ======================================================================================
// FEATURE: WHATSAPP
// Lets riders book and manage rides by chatting with Along on WhatsApp, and lets Along send
// updates (and optionally login codes) over WhatsApp.
//
// TO SWITCH THIS OFF: set WHATSAPP_ENABLED=false in .env and restart. The webhook stops
// answering, no WhatsApp messages are sent, and everything else keeps working.
// Search the code for "FEATURE: WHATSAPP" to find every place it touches.
// ======================================================================================
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { cut } from './whatsapp.format.js';

export const whatsappEnabled = () =>
  env.WHATSAPP_ENABLED === 'true' && Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

const digits = (phone) => String(phone).replace(/\D/g, '');

async function call(payload) {
  try {
    const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'WhatsApp send failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'WhatsApp request error');
    return false;
  }
}

export const sendText = (phone, body) =>
  call({ to: digits(phone), type: 'text', text: { body: cut(body, 4000), preview_url: true } });

/** Up to 3 buttons. Button titles can be 20 characters at most. */
export const sendButtons = (phone, body, buttons) =>
  call({
    to: digits(phone),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: cut(body, 1000) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } })) },
    },
  });

/** A pick-list of up to 10 rows. Row titles can be 24 characters, descriptions 72. */
export const sendList = (phone, body, buttonLabel, rows, sectionTitle = 'Options') =>
  call({
    to: digits(phone),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: cut(body, 1000) },
      action: {
        button: cut(buttonLabel, 20),
        sections: [
          {
            title: cut(sectionTitle, 24),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: cut(r.title, 24),
              ...(r.description && { description: cut(r.description, 72) }),
            })),
          },
        ],
      },
    },
  });

export const sendLocationRequest = (phone, body) =>
  call({
    to: digits(phone),
    type: 'interactive',
    interactive: { type: 'location_request_message', body: { text: cut(body, 1000) }, action: { name: 'send_location' } },
  });

export const sendTemplate = (phone, name, language, components) =>
  call({ to: digits(phone), type: 'template', template: { name, language: { code: language }, components } });
