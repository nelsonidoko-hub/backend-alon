// FEATURE: WHATSAPP (outgoing updates and login codes). Switch off with WHATSAPP_ENABLED=false.
import { env } from '../../config/env.js';
import { WaContact } from './whatsapp.models.js';
import { sendText, sendTemplate, whatsappEnabled } from './whatsapp.client.js';
import { templateText } from './whatsapp.format.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sends an update on WhatsApp. Inside 24 hours of the person's last message it sends normal text.
 * Outside that window WhatsApp only allows an approved template, so it uses WHATSAPP_UPDATE_TEMPLATE.
 * Returns true if something was sent.
 */
export async function whatsappNotify(phone, text) {
  if (!whatsappEnabled()) return false;
  const contact = await WaContact.findOne({ phone }).lean();
  if (contact?.optedOut) return false;
  if (contact?.lastInboundAt && Date.now() - new Date(contact.lastInboundAt).getTime() < DAY_MS) {
    return sendText(phone, text);
  }
  if (!env.WHATSAPP_UPDATE_TEMPLATE) return false;
  return sendTemplate(phone, env.WHATSAPP_UPDATE_TEMPLATE, env.WHATSAPP_TEMPLATE_LANG, [
    { type: 'body', parameters: [{ type: 'text', text: templateText(text) }] },
  ]);
}

/** Sends a login code with an approved "authentication" template (with a copy-code button). */
export async function whatsappSendOtp(phone, code) {
  if (!whatsappEnabled() || !env.WHATSAPP_OTP_TEMPLATE) return false;
  return sendTemplate(phone, env.WHATSAPP_OTP_TEMPLATE, env.WHATSAPP_TEMPLATE_LANG, [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
  ]);
}
