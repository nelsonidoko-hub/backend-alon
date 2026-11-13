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
  const { vehicle, ...profile } = data;
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
  return driver || { status: 'not_applied' };
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

async function setStatus(driverId, adminUser, patch, notice) {
  const driver = await Driver.findByIdAndUpdate(driverId, { $set: patch }, { new: true });
  if (!driver) throw new AppError(404, 'Driver not found', 'NOT_FOUND');
  notifyUser(driver.userId, 'driver:status', { status: driver.status }, { title: 'Along', body: notice, sms: true });
  return driver;
}

export const approveDriver = (id, admin) =>
  setStatus(
    id,
    admin,
    { status: 'approved', approvedBy: admin._id, approvedAt: new Date(), rejectionReason: null },
    'Your Along driver account is approved. You can go online now.'
  );

export const rejectDriver = (id, admin, reason) =>
  setStatus(id, admin, { status: 'rejected', rejectionReason: reason }, `Your Along driver application was not approved: ${reason}`);

export async function suspendDriver(id, admin) {
  const driver = await setStatus(id, admin, { status: 'suspended' }, 'Your Along driver account has been suspended.');
  await endActiveSession(driver._id, 'Driver account suspended');
  return driver;
}
