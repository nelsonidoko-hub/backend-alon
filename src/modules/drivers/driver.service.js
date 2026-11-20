import { driverUrl, env } from '../../config/env.js';
import { trialInfo } from './trial.js';
import { AppError } from '../../utils/AppError.js';
import { Driver } from './driver.model.js';
import { Vehicle } from './vehicle.model.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { endActiveSession } from '../sessions/sessions.service.js';
import { fileUrl } from '../uploads/storage.service.js';

export async function applyAsDriver(user, data) {
  if (!user.name) {
    throw new AppError(400, 'Set your name first (PATCH /me)', 'NAME_REQUIRED');
  }
  const { vehicle, phone, ...profile } = data;
  if (!user.phone) {
    if (!phone) throw new AppError(400, 'Add your phone number so riders and our team can reach you', 'PHONE_REQUIRED');
    const User = user.constructor;
    if (await User.exists({ phone, _id: { $ne: user._id } })) throw new AppError(409, 'That phone number belongs to another account', 'PHONE_TAKEN');
    user.phone = phone; // not yet proven by SMS: our team calls it before approving the driver
    await user.save();
  }
  const prefixes = {
    profilePhotoKey: `profiles/${user._id}/`,
    licencePhotoKey: `docs/${user._id}/`,
    idPhotoKey: `docs/${user._id}/`,
    vehiclePapersKey: `docs/${user._id}/`,
  };
  for (const [field, prefix] of Object.entries(prefixes)) {
    if (profile[field] && !profile[field].startsWith(prefix)) {
      throw new AppError(400, `Invalid file for ${field}`, 'INVALID_FILE');
    }
  }
  const plate = vehicle.plate.toUpperCase().replace(/\s+/g, '');

  let driver = await Driver.findOne({ userId: user._id });
  if (driver && ['approved', 'suspended'].includes(driver.status)) {
    throw new AppError(409, `Application is ${driver.status}`, 'ALREADY_PROCESSED');
  }

  const taken = await Vehicle.findOne({ plate });
  if (taken && (!driver || String(taken._id) !== String(driver.vehicleId))) {
    throw new AppError(409, 'This plate number is already registered', 'PLATE_TAKEN');
  }

  let vehicleDoc;
  if (driver) {
    vehicleDoc = await Vehicle.findByIdAndUpdate(driver.vehicleId, { ...vehicle, plate }, { new: true });
  } else {
    vehicleDoc = await Vehicle.create({ ...vehicle, plate });
  }

  if (driver) {
    Object.assign(driver, profile, { vehicleId: vehicleDoc._id, status: 'pending', rejectionReason: undefined });
    await driver.save();
  } else {
    driver = await Driver.create({ ...profile, userId: user._id, vehicleId: vehicleDoc._id });
  }
  return Driver.findById(driver._id).populate('vehicleId');
}

export async function getDriverStatus(user) {
  const driver = await Driver.findOne({ userId: user._id }).populate('vehicleId');
  const opts = { trialDays: env.DRIVER_TRIAL_DAYS, commissionPercent: env.COMMISSION_PERCENT };
  if (!driver) return { status: 'not_applied', trial: { days: opts.trialDays, commissionPercent: opts.commissionPercent, active: false } };
  const o = driver.toObject();
  // Drivers still waiting for approval have not started the trial yet.
  o.trial = driver.status === 'approved' || driver.status === 'suspended' ? trialInfo(driver, opts) : { days: opts.trialDays, commissionPercent: opts.commissionPercent, active: false, daysLeft: opts.trialDays, notStarted: true };
  return o;
}

export async function listDrivers(status) {
  const filter = status ? { status } : {};
  const drivers = await Driver.find(filter)
    .sort('-createdAt')
    .limit(200)
    .populate('userId', 'name phone')
    .populate('vehicleId')
    .lean();
  return Promise.all(
    drivers.map(async (d) => ({
      ...d,
      documents: {
        profilePhoto: await fileUrl(d.profilePhotoKey),
        licence: await fileUrl(d.licencePhotoKey),
        id: await fileUrl(d.idPhotoKey),
        vehiclePapers: await fileUrl(d.vehiclePapersKey),
      },
    }))
  );
}

async function setStatus(driverId, adminUser, patch, notice, email) {
  const driver = await Driver.findByIdAndUpdate(driverId, { $set: patch }, { new: true });
  if (!driver) throw new AppError(404, 'Driver not found', 'NOT_FOUND');
  notifyUser(driver.userId, 'driver:status', { status: driver.status }, { title: 'FoloRide', body: notice, sms: true, email });
  return driver;
}

export const approveDriver = (id, admin) =>
  setStatus(
    id,
    admin,
    { status: 'approved', approvedBy: admin._id, approvedAt: new Date(), rejectionReason: null },
    'Your FoloRide driver account is approved. You can go online now.',
    { subject: 'Your FoloRide driver account is approved', heading: 'You are approved', lines: ['Your driver application has been approved. Open the driver app, choose your route and go online to start receiving riders.', ...(env.DRIVER_TRIAL_DAYS ? [`Your first ${env.DRIVER_TRIAL_DAYS} days are commission-free, so you keep every naira you earn. After that FoloRide takes ${env.COMMISSION_PERCENT}% of every trip. On cash trips you keep the cash and the commission is taken from your wallet, so keep a little balance in it.`] : [])], button: { label: 'Open the driver app', url: driverUrl } }
  );

export const rejectDriver = (id, admin, reason) =>
  setStatus(id, admin, { status: 'rejected', rejectionReason: reason }, `Your FoloRide driver application was not approved: ${reason}`, {
    subject: 'About your FoloRide driver application',
    heading: 'Your application was not approved',
    lines: [`Reason: ${reason}`, 'You can fix this and apply again from the driver app.'],
    button: { label: 'Open the driver app', url: driverUrl },
  });

export async function suspendDriver(id, admin) {
  const driver = await setStatus(id, admin, { status: 'suspended' }, 'Your FoloRide driver account has been suspended.');
  await endActiveSession(driver._id, 'Driver account suspended');
  return driver;
}
