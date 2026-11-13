// FEATURE: WHATSAPP (webhook that receives messages from Meta). Switch off with WHATSAPP_ENABLED=false.
import { Router } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { WaMessage } from './whatsapp.models.js';
import { whatsappEnabled } from './whatsapp.client.js';
import { validSignature } from './signature.js';
import { handleInboundSafely } from './whatsapp.bot.js';

export const whatsappRouter = Router();

// Meta calls this once, when you save the webhook in the Meta dashboard.
// The query is read from the URL because the sanitizer strips keys that contain dots (hub.mode).
whatsappRouter.get('/', (req, res) => {
  if (!whatsappEnabled()) return res.sendStatus(404);
  const q = new URL(req.originalUrl, 'http://local').searchParams;
  if (q.get('hub.mode') === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && q.get('hub.verify_token') === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(q.get('hub.challenge'));
  }
  return res.sendStatus(403);
});

async function isNew(mid) {
  try {
    await WaMessage.create({ mid });
    return true;
  } catch (e) {
    if (e.code === 11000) return false;
    throw e;
  }
}

async function processWebhook(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages) continue;
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const msg of value.messages) {
        if (await isNew(msg.id)) await handleInboundSafely(msg, profileName);
      }
    }
  }
}

whatsappRouter.post('/', (req, res) => {
  if (!whatsappEnabled()) return res.sendStatus(404);
  if (!validSignature(req.rawBody, req.headers['x-hub-signature-256'], env.WHATSAPP_APP_SECRET)) {
    return res.sendStatus(401);
  }
  res.sendStatus(200); // answer fast, Meta retries if we are slow
  processWebhook(req.body).catch((err) => logger.error({ err }, 'WhatsApp webhook processing failed'));
});
