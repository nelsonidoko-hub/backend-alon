// FEATURE: WHATSAPP (the booking chat). Switch off with WHATSAPP_ENABLED=false.
import { env, driverUrl } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { normalizePhone } from '../../utils/phone.js';
import { User } from '../users/user.model.js';
import { listRoutes, getRouteGeometry, getFare } from '../routes/routes.service.js';
import { listLiveCabs } from '../sessions/sessions.service.js';
import { DriverSession } from '../sessions/session.model.js';
import { createBooking, getActiveBooking, cancelByPassenger, createShareLink } from '../bookings/bookings.service.js';
import { walletView, startTopup } from '../wallet/wallet.service.js';
import { createSos } from '../sos/sos.service.js';
import { SosAlert } from '../sos/sos.model.js';
import { createAlert } from '../alerts/route-alerts.service.js';
import { recordInterest } from '../demand/demand.service.js'; // FEATURE: DRIVER DEMAND ALERTS counts WhatsApp searches too
import { sendSms } from '../notifications/sms.service.js';
import { emitToAdmin } from '../../realtime/io.js';
import { WaContact } from './whatsapp.models.js';
import * as wa from './whatsapp.client.js';
import { cut, first, naira, pageRows } from './whatsapp.format.js';

const recent = new Map();

function tooBusy(phone) {
  const now = Date.now();
  const hits = (recent.get(phone) || []).filter((t) => now - t < 60000);
  hits.push(now);
  recent.set(phone, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 30;
}

const MENU = [
  { id: 'm:book', title: 'Book a ride' },
  { id: 'm:trip', title: 'My trip' },
  { id: 'm:wallet', title: 'Wallet' },
];

const menu = (phone, user, intro) =>
  wa.sendButtons(
    phone,
    `${intro || `Hi ${first(user?.name)}! What would you like to do?`}\n\nType SOS at any time if you need help.`,
    MENU
  );

export async function handleInbound(msg, profileName) {
  const phone = normalizePhone(msg.from);
  if (!phone) return wa.sendText(msg.from, 'Sorry, FoloRide works with Nigerian phone numbers for now.');
  if (tooBusy(phone)) return null;

  const contact = await WaContact.findOneAndUpdate(
    { phone },
    { $set: { lastInboundAt: new Date() } },
    { upsert: true, new: true }
  );
  const user = await User.findOne({ phone });
  if (!user) return onboard(phone, contact, msg, profileName);
  if (user.status === 'blocked') return wa.sendText(phone, 'Your FoloRide account is blocked. Please contact support.');
  if (user.role === 'driver') {
    return wa.sendText(phone, `Drivers use the FoloRide app, so riders can see your live location. Open it here: ${driverUrl}`);
  }
  if (user.role !== 'passenger') return wa.sendText(phone, 'This number belongs to an FoloRide admin account. Please use the admin app.');

  // Chatting with FoloRide counts as agreeing to get updates here, unless they asked to stop.
  if (!contact.optedOut && user.notificationPrefs?.whatsapp !== true) {
    await User.updateOne({ _id: user._id }, { $set: { 'notificationPrefs.whatsapp': true } });
  }

  if (msg.type === 'location') return onLocation(user, phone, msg.location);
  if (msg.type === 'interactive') {
    const id = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
    if (id) return onChoice(user, phone, id);
  }
  const text = msg.type === 'text' ? String(msg.text?.body || '').trim().toLowerCase() : '';
  return onText(user, phone, contact, text);
}

async function onboard(phone, contact, msg, profileName) {
  if (contact.pendingName && msg.type === 'text') {
    const name = String(msg.text?.body || '').trim().slice(0, 80);
    if (name.length < 2 || /\d{5,}/.test(name)) {
      return wa.sendText(phone, 'Please reply with your name, at least 2 letters.');
    }
    const user = await User.create({
      phone,
      name,
      role: 'passenger',
      phoneVerifiedAt: new Date(),
      notificationPrefs: { sms: true, whatsapp: true },
    });
    await WaContact.updateOne({ _id: contact._id }, { $set: { pendingName: false, userId: user._id } });
    await wa.sendText(phone, `Welcome to FoloRide, ${first(name)}! Your rider account is ready.`);
    return menu(phone, user, 'What would you like to do?');
  }
  await WaContact.updateOne({ _id: contact._id }, { $set: { pendingName: true } });
  const terms = env.TERMS_URL ? ` By continuing you agree to our terms: ${env.TERMS_URL}` : '';
  const hello = profileName ? `Hi ${first(profileName)}! ` : '';
  return wa.sendText(
    phone,
    `${hello}Welcome to FoloRide. See shared cabs on your route, book a seat and travel with a fixed fare.\n\nTo create your rider account, reply with your name.${terms}`
  );
}

async function onText(user, phone, contact, text) {
  if (/^(stop|unsubscribe)$/.test(text)) {
    await WaContact.updateOne({ _id: contact._id }, { $set: { optedOut: true } });
    await User.updateOne({ _id: user._id }, { $set: { 'notificationPrefs.whatsapp': false } });
    return wa.sendText(phone, 'You will not get updates on WhatsApp any more. Send START to turn them back on.');
  }
  if (text === 'start') {
    await WaContact.updateOne({ _id: contact._id }, { $set: { optedOut: false } });
    await User.updateOne({ _id: user._id }, { $set: { 'notificationPrefs.whatsapp': true } });
    return menu(phone, user, 'WhatsApp updates are back on.');
  }
  if (/^(sos|help me|emergency)$/.test(text)) return sos(user, phone);
  if (/^(trip|my trip|status)$/.test(text)) return showTrip(user, phone);
  if (/^(wallet|balance)$/.test(text)) return showWallet(user, phone);
  if (/^(book|ride|1)$/.test(text)) return routesList(phone);
  if (text === 'cancel') return showTrip(user, phone);
  return menu(phone, user);
}

async function onChoice(user, phone, id) {
  const [kind, a, b, c, d] = id.split(':');
  switch (kind) {
    case 'm':
      if (a === 'book') return routesList(phone);
      if (a === 'trip') return showTrip(user, phone);
      if (a === 'wallet') return showWallet(user, phone);
      return menu(phone, user);
    case 'r': return stopsFrom(phone, a, 0);
    case 'fp': return stopsFrom(phone, a, Number(b) || 0);
    case 'f': return stopsTo(phone, a, b, 0);
    case 'tp': return stopsTo(phone, a, b, Number(c) || 0);
    case 't': return showCabs(user, phone, a, b, c);
    case 'c': return askPayment(user, phone, a, b, c);
    case 'p': return book(user, phone, a, b, c, d);
    case 'x': return cancel(user, phone, a);
    case 's': return share(user, phone, a);
    case 'a': return alertMe(user, phone, a, b);
    case 'w': return topup(user, phone, Number(a));
    default: return menu(phone, user);
  }
}

async function routesList(phone) {
  const routes = await listRoutes();
  if (!routes.length) return wa.sendText(phone, 'There are no routes available yet. Please check again soon.');
  return wa.sendList(phone, 'Which route are you taking?', 'Choose route',
    routes.slice(0, 10).map((r) => ({ id: `r:${r.id}`, title: r.name, description: `${r.stopCount} stops` })), 'Routes');
}

async function stopsFrom(phone, routeId, page) {
  const g = await getRouteGeometry(routeId);
  const stops = g.stops.slice(0, -1);
  const rows = pageRows(stops, page, (s) => ({ id: `f:${routeId}:${s.stopId}`, title: s.name }), (p) => `fp:${routeId}:${p}`);
  return wa.sendList(phone, `${g.route.name}\nWhere do you get on?`, 'Choose stop', rows, 'Pick-up stop');
}

async function stopsTo(phone, routeId, fromId, page) {
  const g = await getRouteGeometry(routeId);
  const idx = g.stops.findIndex((s) => s.stopId === fromId);
  if (idx < 0 || idx === g.stops.length - 1) return wa.sendText(phone, 'That stop is not on this route. Type "book" to start again.');
  const stops = g.stops.slice(idx + 1);
  const rows = pageRows(stops, page, (s) => ({ id: `t:${routeId}:${fromId}:${s.stopId}`, title: s.name }), (p) => `tp:${routeId}:${fromId}:${p}`);
  return wa.sendList(phone, `From ${g.stops[idx].name}.\nWhere do you get off?`, 'Choose stop', rows, 'Drop-off stop');
}

async function showCabs(user, phone, routeId, fromId, toId) {
  recordInterest(user._id, routeId, fromId); // FEATURE: DRIVER DEMAND ALERTS
  const cabs = (await listLiveCabs(routeId, fromId, toId)).filter((c) => !c.full);
  if (!cabs.length) {
    return wa.sendButtons(phone, 'No cabs with free seats on this route right now.\n\nWant me to message you when one is near your stop?', [
      { id: `a:${routeId}:${fromId}`, title: 'Alert me' },
      { id: 'm:book', title: 'Other route' },
      { id: 'm:menu', title: 'Menu' },
    ]);
  }
  const rows = cabs.slice(0, 10).map((c) => ({
    id: `c:${c.sessionId}:${fromId}:${toId}`,
    title: `${Math.max(1, Math.round(c.etaSeconds / 60))} min · ${c.seatsFree} seat${c.seatsFree === 1 ? '' : 's'}`,
    description: `${c.vehicle ? `${c.vehicle.colour} ${c.vehicle.make} ${c.vehicle.plate}` : 'Cab'} · ${naira(c.fare)}`,
  }));
  return wa.sendList(phone, 'These cabs are heading your way. Pick one to book a seat.', 'See cabs', rows, 'Cabs');
}

async function askPayment(user, phone, sessionId, fromId, toId) {
  const routeId = await routeOfSession(sessionId);
  const cab = routeId ? (await listLiveCabs(routeId, fromId, toId)).find((c) => c.sessionId === sessionId) : null;
  if (!cab) return wa.sendText(phone, 'That cab is no longer available. Type "book" to see the cabs again.');
  const fare = cab.fare ?? (await getFare(routeId, fromId, toId));
  const w = await walletView(user);
  const buttons = [{ id: `p:cash:${sessionId}:${fromId}:${toId}`, title: 'Pay cash' }];
  buttons.push(
    w.balance >= fare * 100
      ? { id: `p:wallet:${sessionId}:${fromId}:${toId}`, title: 'Pay from wallet' }
      : { id: 'm:wallet', title: 'Top up wallet' }
  );
  return wa.sendButtons(phone, `${naira(fare)} for one seat. How would you like to pay?\nWallet balance: ${naira(w.balance / 100)}`, buttons);
}

async function routeOfSession(sessionId) {
  const s = await DriverSession.findById(sessionId).select('routeId').lean();
  return s ? String(s.routeId) : null;
}

async function book(user, phone, method, sessionId, fromId, toId) {
  const b = await createBooking(user, {
    sessionId,
    fromStopId: fromId,
    toStopId: toId,
    seats: 1,
    paymentMethod: method === 'wallet' ? 'wallet' : 'cash',
  });
  const eta = b.cab?.etaSeconds != null ? `\nThe cab is about ${Math.max(1, Math.round(b.cab.etaSeconds / 60))} min from your stop.` : '';
  await wa.sendText(
    phone,
    `Seat booked.\n\n${b.route.name}\n${b.from.name} to ${b.to.name}\nCab: ${b.vehicle ? `${b.vehicle.colour} ${b.vehicle.make} ${b.vehicle.model}, ${b.vehicle.plate}` : 'Cab'}\nDriver: ${b.driver.name}\nFare: ${naira(b.fare)} (${b.paymentMethod})${eta}\n\nYour code: ${b.code}\nGive this code to the driver when you board.`
  );
  return wa.sendButtons(phone, 'You can also share your trip with someone.', [
    { id: `s:${b.id}`, title: 'Share trip' },
    { id: `x:${b.id}`, title: 'Cancel booking' },
    { id: 'm:trip', title: 'My trip' },
  ]);
}

async function showTrip(user, phone) {
  const b = await getActiveBooking(user);
  if (!b) return wa.sendButtons(phone, 'You have no active trip.', [{ id: 'm:book', title: 'Book a ride' }, { id: 'm:wallet', title: 'Wallet' }]);
  const status = { confirmed: 'Seat booked. Wait at your stop.', arriving: 'Your cab is almost there.', picked_up: 'You are on your way.' }[b.status] || b.status;
  const eta = b.cab?.etaSeconds != null ? `\nCab arrives in about ${Math.max(1, Math.round(b.cab.etaSeconds / 60))} min.` : '';
  const buttons = [{ id: `s:${b.id}`, title: 'Share trip' }];
  if (b.status === 'confirmed') buttons.push({ id: `x:${b.id}`, title: 'Cancel booking' });
  buttons.push({ id: 'm:menu', title: 'Menu' });
  return wa.sendButtons(
    phone,
    `${b.from.name} to ${b.to.name}\n${status}${eta}\nCab: ${b.vehicle ? `${b.vehicle.colour} ${b.vehicle.make}, ${b.vehicle.plate}` : 'Cab'}\nYour code: ${b.code}`,
    buttons
  );
}

async function cancel(user, phone, bookingId) {
  await cancelByPassenger(user, bookingId, 'Cancelled on WhatsApp');
  return wa.sendButtons(phone, 'Your booking is cancelled. Any money held for it has been returned to your wallet.', [{ id: 'm:book', title: 'Book a ride' }, { id: 'm:menu', title: 'Menu' }]);
}

async function share(user, phone, bookingId) {
  const l = await createShareLink(user, bookingId);
  return wa.sendText(phone, `Send this link to anyone you want to follow your trip live:\n${l.url}`);
}

async function alertMe(user, phone, routeId, fromId) {
  await createAlert(user, { routeId, fromStopId: fromId, days: [0, 1, 2, 3, 4, 5, 6], startTime: '06:00', endTime: '22:00' });
  return wa.sendText(phone, 'Done. I will message you when a cab with free seats is close to your stop, between 6am and 10pm. You can change this in the FoloRide app under Inbox, Route alerts.');
}

async function showWallet(user, phone) {
  const w = await walletView(user);
  const held = w.held > 0 ? `\nHeld for booked rides: ${naira(w.held / 100)}` : '';
  if (!w.paymentsEnabled) return wa.sendText(phone, `Wallet balance: ${naira(w.balance / 100)}${held}\n\nTop-ups are not available yet.`);
  return wa.sendButtons(phone, `Wallet balance: ${naira(w.balance / 100)}${held}\n\nAdd money:`, [
    { id: 'w:1000', title: 'Add ₦1,000' },
    { id: 'w:2000', title: 'Add ₦2,000' },
    { id: 'w:5000', title: 'Add ₦5,000' },
  ]);
}

async function topup(user, phone, amount) {
  if (![1000, 2000, 5000].includes(amount)) return showWallet(user, phone);
  const t = await startTopup(user, amount);
  return wa.sendText(phone, `Pay ${naira(amount)} securely with Paystack:\n${t.authorizationUrl}\n\nYour wallet is updated as soon as the payment goes through.`);
}

async function sos(user, phone) {
  const active = await getActiveBooking(user);
  await createSos(user, { bookingId: active?.id, note: 'Sent from WhatsApp' });
  await wa.sendText(phone, 'SOS sent to the FoloRide team and your emergency contact (if you added one in the app). If you are in danger, call the emergency services now (112 in Nigeria).');
  return wa.sendLocationRequest(phone, 'Share your location so we can find you.');
}

async function onLocation(user, phone, loc) {
  const alert = await SosAlert.findOneAndUpdate(
    { userId: user._id, status: 'open', createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) }, 'location.lat': { $exists: false } },
    { $set: { location: { lat: loc.latitude, lng: loc.longitude } } },
    { sort: { createdAt: -1 }, new: true }
  );
  if (!alert) return wa.sendText(phone, 'Thanks. I only use shared locations for SOS alerts. Type "menu" to see what I can do.');
  emitToAdmin('sos:triggered', {
    alertId: String(alert._id), userId: String(user._id), name: user.name, phone: user.phone,
    bookingId: alert.bookingId ? String(alert.bookingId) : null, location: alert.location, note: alert.note, at: alert.createdAt,
  });
  if (user.emergencyContact?.phone) {
    await sendSms(user.emergencyContact.phone, `SOS from ${user.name || user.phone} on FoloRide. Location: https://maps.google.com/?q=${loc.latitude},${loc.longitude}`);
  }
  return wa.sendText(phone, 'Location received. Our team has it.');
}

/** Entry point from the webhook. Friendly errors go back to the rider, anything else is logged. */
export async function handleInboundSafely(msg, profileName) {
  try {
    await handleInbound(msg, profileName);
  } catch (err) {
    logger.error({ err }, 'WhatsApp handler failed');
    const phone = `+${msg.from}`;
    const text = err?.statusCode && err.statusCode < 500 ? cut(err.message, 300) : 'Something went wrong. Please try again, or use the FoloRide app.';
    await wa.sendText(phone, text).catch(() => {});
  }
}
