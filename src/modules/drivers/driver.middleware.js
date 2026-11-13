import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { Driver } from './driver.model.js';

export const requireApprovedDriver = asyncHandler(async (req, _res, next) => {
  const driver = await Driver.findOne({ userId: req.user._id }).populate('vehicleId');
  if (!driver) throw new AppError(403, 'Submit a driver application first', 'NOT_A_DRIVER');
  if (driver.status !== 'approved') {
    throw new AppError(403, `Driver account is ${driver.status}`, 'DRIVER_NOT_APPROVED');
  }
  req.driver = driver;
  next();
});
