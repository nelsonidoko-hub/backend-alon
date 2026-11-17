import { User } from '../users/user.model.js';
import { Driver } from '../drivers/driver.model.js';
import { Vehicle } from '../drivers/vehicle.model.js';
import { Booking } from '../bookings/booking.model.js';
import { CommuteBooking, CommuteTrip, CommuteSchedule } from '../commute/commute.models.js';
import { Wallet, LedgerEntry, Topup, BankAccount, Withdrawal } from '../wallet/wallet.models.js';
import { Notification } from '../notifications/notification.model.js';
import { RouteAlert } from '../alerts/route-alert.model.js';
import { Complaint } from '../complaints/complaint.model.js';
import { Rating } from '../ratings/rating.model.js';
import { RefreshToken } from '../auth/refreshToken.model.js';
import { WaContact } from '../whatsapp/whatsapp.models.js';
import { consumeOtp } from '../auth/auth.service.js';
import { endActiveSession } from '../sessions/sessions.service.js';
import { deleteObjects } from '../uploads/storage.service.js';
import { AuditLog } from '../audit/audit.model.js';
import { AppError } from '../../utils/AppError.js';

const naira = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG')}`;
const CAP = 1000;

/** Everything FoloRide holds about this person, as a JSON object they can download. */
export async function exportData(user) {
  const id = user._id;
  const driver = await Driver.findOne({ userId: id }).populate('vehicleId').lean();
  const [wallet, ledger, topups, withdrawals, banks, rides, commute, trips, alerts, complaints, notifications, ratings] = await Promise.all([
    Wallet.findOne({ userId: id }).lean(),
    LedgerEntry.find({ userId: id }).sort('-createdAt').limit(CAP).lean(),
    Topup.find({ userId: id }).sort('-createdAt').limit(CAP).lean(),
    Withdrawal.find({ userId: id }).sort('-createdAt').limit(CAP).lean(),
    BankAccount.find({ userId: id }).select('bankName accountLast4 accountName active createdAt').lean(),
    Booking.find({ $or: [{ passengerId: id }, { driverUserId: id }] }).select('-code -shareToken').sort('-requestedAt').limit(CAP).lean(),
    CommuteBooking.find({ $or: [{ passengerId: id }, { driverUserId: id }] }).select('-code').sort('-createdAt').limit(CAP).lean(),
    CommuteTrip.find({ driverUserId: id }).sort('-departAt').limit(CAP).lean(),
    RouteAlert.find({ userId: id }).lean(),
    Complaint.find({ userId: id }).lean(),
    Notification.find({ userId: id }).sort('-createdAt').limit(200).lean(),
    Rating.find({ $or: [{ passengerId: id }, { driverId: driver?._id }] }).limit(CAP).lean(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    profile: user.toJSON(),
    driver,
    wallet,
    ledger,
    topups,
    withdrawals,
    bankAccounts: banks,
    rides,
    commuteBookings: commute,
    commuteTripsAsDriver: trips,
    routeAlerts: alerts,
    complaints,
    notifications,
    ratings,
    note: 'Trip codes and share links are left out for your safety. Lists show up to the latest 1000 records.',
  };
}

async function blockers(user) {
  const id = user._id;
  const [ride, commute, trip, wallet, withdrawal] = await Promise.all([
    Booking.exists({ active: true, $or: [{ passengerId: id }, { driverUserId: id }] }),
    CommuteBooking.exists({ active: true, $or: [{ passengerId: id }, { driverUserId: id }] }),
    CommuteTrip.exists({ driverUserId: id, status: { $in: ['scheduled', 'in_progress'] } }),
    Wallet.findOne({ userId: id }).lean(),
    Withdrawal.exists({ userId: id, status: { $in: ['pending_review', 'processing'] } }),
  ]);
  if (ride || commute) throw new AppError(409, 'Finish or cancel your active trips first', 'ACTIVE_TRIPS');
  if (trip) throw new AppError(409, 'Cancel your upcoming carpool trips first', 'ACTIVE_TRIPS');
  if (withdrawal) throw new AppError(409, 'Wait for your withdrawal to finish first', 'PENDING_WITHDRAWAL');
  if (wallet && (wallet.balance > 0 || wallet.held > 0)) {
    throw new AppError(
      409,
      `Your wallet still has ${naira(wallet.balance + wallet.held)}. Drivers can withdraw it. Riders can contact support for a refund. Then try again.`,
      'WALLET_NOT_EMPTY'
    );
  }
}

/**
 * Deletes a person's account. Records we must keep (trips, payments, safety reports) stay, but are
 * no longer linked to a name or phone number. Files, bank details, alerts and messages are erased.
 */
export async function deleteAccount(user, code) {
  if (user.role === 'admin') throw new AppError(403, 'Admin accounts cannot be deleted here', 'FORBIDDEN');
  await blockers(user);
  await consumeOtp(user.phone, code);

  const id = user._id;
  const tag = String(id);
  const driver = await Driver.findOne({ userId: id });
  if (driver) {
    await endActiveSession(driver._id, 'The driver account was deleted');
    await deleteObjects([driver.profilePhotoKey, driver.licencePhotoKey, driver.idPhotoKey, driver.vehiclePapersKey]);
    await Driver.updateOne(
      { _id: driver._id },
      { $set: { status: 'deleted', licenceNumber: 'deleted' }, $unset: { profilePhotoKey: 1, licencePhotoKey: 1, idPhotoKey: 1, vehiclePapersKey: 1 } }
    );
    await Vehicle.updateOne({ _id: driver.vehicleId }, { $set: { plate: `DELETED-${tag.slice(-8)}` } });
    await CommuteSchedule.updateMany({ driverUserId: id }, { $set: { active: false } });
  }
  await Promise.all([
    BankAccount.deleteMany({ userId: id }),
    Notification.deleteMany({ userId: id }),
    RouteAlert.deleteMany({ userId: id }),
    RefreshToken.deleteMany({ userId: id }),
    WaContact.deleteMany({ phone: user.phone }),
  ]);
  await User.updateOne(
    { _id: id },
    {
      $set: { status: 'deleted', phone: `deleted-${tag}`, name: 'Deleted user', notificationPrefs: { sms: false, whatsapp: false } },
      $unset: { emergencyContact: 1, organization: 1, pushSubscriptions: 1, phoneVerifiedAt: 1 },
    }
  );
  await AuditLog.create({ actorId: id, actorName: 'Deleted user', method: 'DELETE', route: '/privacy/delete', url: '/privacy/delete', status: 200 });
  return { ok: true };
}
