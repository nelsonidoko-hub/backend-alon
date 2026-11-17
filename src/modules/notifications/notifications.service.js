import { sendEmail } from './email.service.js';
import { emailUser } from './email.notify.js';
import webpush from 'web-push';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { User } from '../users/user.model.js';
import { emitToUser, isUserOnline } from '../../realtime/io.js';
import { sendSms } from './sms.service.js';
import { Notification } from './notification.model.js';
import { whatsappNotify } from '../whatsapp/whatsapp.notify.js'; // FEATURE: WHATSAPP

export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export const presentNotification = (n) => ({
  id: String(n._id),
  type: n.type,
  title: n.title,
  body: n.body,
  url: n.url,
  readAt: n.readAt || null,
  createdAt: n.createdAt,
});

/**
 * Sends a live event to the user's open app. When a title is given it is also saved to the
 * user's inbox, sent as a push if the app is closed, and (if sms is true) as an SMS when push is not possible.
 */
export async function notifyUser(userId, event, payload = {}, { title, body, sms = false, whatsapp = false, type, url, email } = {}) {
  try {
    emitToUser(userId, event, payload);
    // email: true sends the title and body as an email; an object gives a richer one (see email.notify.js). Sent whether or not the app is open.
    if (email) emailUser(userId, email === true ? { subject: title, heading: title, lines: [body] } : email);
    if (title) {
      const item = await Notification.create({ userId, type: type || event, title, body, url, data: payload });
      emitToUser(userId, 'notification:new', presentNotification(item));
    }
    if (await isUserOnline(userId)) return;

    const user = await User.findById(userId).select('phone email notificationPrefs +pushSubscriptions');
    if (!user) return;

    let pushed = false;
    if (pushEnabled && title && user.pushSubscriptions?.length) {
      for (const sub of user.pushSubscriptions) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title, body, event, data: { ...payload, url } })
          );
          pushed = true;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await User.updateOne({ _id: userId }, { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } });
          }
        }
      }
    }
    // >>> FEATURE: WHATSAPP (start). Riders who chat with FoloRide, or turn it on in Profile, get important updates here. Off with WHATSAPP_ENABLED=false
    if (!pushed && (sms || whatsapp) && body && user.notificationPrefs?.whatsapp === true) {
      if (user.phone && await whatsappNotify(user.phone, title ? `${title}\n${body}` : body)) return;
    }
    // <<< FEATURE: WHATSAPP (end)
    const smsAllowed = user.notificationPrefs?.sms !== false;
    if (!pushed && sms && smsAllowed && body) {
      if (user.phone) await sendSms(user.phone, body);
      else if (user.email && !email) await sendEmail(user.email, title || 'FoloRide', body); // email-only accounts
    }
  } catch (err) {
    logger.error({ err }, 'notifyUser failed');
  }
}
