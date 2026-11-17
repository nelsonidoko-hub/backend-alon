import { SosAlert } from './sos.model.js';
import { Booking } from '../bookings/booking.model.js';
import { CommuteBooking } from '../commute/commute.models.js';
import { ensureShareToken } from '../bookings/bookings.service.js';
import { sendSms } from '../notifications/sms.service.js';
import { emitToAdmin } from '../../realtime/io.js';
import { env, riderUrl } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

export async function createSos(user, { bookingId, commuteBookingId, lat, lng, note }) {
  let booking = null;
  if (bookingId) {
    booking = await Booking.findOne({
      _id: bookingId,
      $or: [{ passengerId: user._id }, { driverUserId: user._id }],
    });
  }
  let commuteBooking = null;
  if (commuteBookingId) {
    commuteBooking = await CommuteBooking.findOne({
      _id: commuteBookingId,
      $or: [{ passengerId: user._id }, { driverUserId: user._id }],
    });
  }
  const hasLocation = lat !== undefined && lng !== undefined;
  const alert = await SosAlert.create({
    userId: user._id,
    bookingId: booking?._id,
    commuteBookingId: commuteBooking?._id,
    location: hasLocation ? { lat, lng } : undefined,
    note,
  });

  let tripLink = '';
  if (booking?.active && String(booking.passengerId) === String(user._id)) {
    tripLink = ` Trip: ${riderUrl}/share/${await ensureShareToken(booking)}`;
  }

  let contactNotified = false;
  const contact = user.emergencyContact;
  if (contact?.phone) {
    const where = hasLocation ? ` Location: https://maps.google.com/?q=${lat},${lng}.` : '';
    await sendSms(contact.phone, `SOS from ${user.name || user.phone} on FoloRide.${where}${tripLink}`);
    contactNotified = true;
  }

  emitToAdmin('sos:triggered', {
    alertId: String(alert._id),
    userId: String(user._id),
    name: user.name,
    phone: user.phone,
    bookingId: booking ? String(booking._id) : null,
    commuteBookingId: commuteBooking ? String(commuteBooking._id) : null,
    location: hasLocation ? { lat, lng } : null,
    note,
    at: alert.createdAt,
  });
  return { alert, contactNotified };
}

export const listAlerts = (status) =>
  SosAlert.find(status ? { status } : {}).sort('-createdAt').limit(200).populate('userId', 'name phone role');

export async function handleAlert(id, admin) {
  const alert = await SosAlert.findByIdAndUpdate(
    id,
    { $set: { status: 'handled', handledBy: admin._id, handledAt: new Date() } },
    { new: true }
  );
  if (!alert) throw new AppError(404, 'Alert not found', 'NOT_FOUND');
  return alert;
}
