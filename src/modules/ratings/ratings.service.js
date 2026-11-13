import { Rating } from './rating.model.js';
import { RiderRating } from './rider-rating.model.js';
import { User } from '../users/user.model.js';
import { Booking } from '../bookings/booking.model.js';
import { Driver } from '../drivers/driver.model.js';
import { AppError } from '../../utils/AppError.js';

export async function createRating(user, bookingId, { score, comment }) {
  const booking = await Booking.findOne({ _id: bookingId, passengerId: user._id });
  if (!booking) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  if (booking.status !== 'completed') throw new AppError(409, 'You can rate a completed trip only', 'NOT_COMPLETED');

  const claimed = await Booking.findOneAndUpdate({ _id: bookingId, rated: { $ne: true } }, { $set: { rated: true } });
  if (!claimed) throw new AppError(409, 'You already rated this trip', 'ALREADY_RATED');

  const rating = await Rating.create({
    bookingId,
    passengerId: user._id,
    driverId: booking.driverId,
    score,
    comment,
  });
  const [agg] = await Rating.aggregate([
    { $match: { driverId: booking.driverId } },
    { $group: { _id: null, avg: { $avg: '$score' }, n: { $sum: 1 } } },
  ]);
  await Driver.updateOne(
    { _id: booking.driverId },
    { $set: { ratingAvg: Math.round(agg.avg * 100) / 100, ratingCount: agg.n } }
  );
  return rating;
}

/** A driver rates the rider after a completed trip. */
export async function rateRider(driverUser, bookingId, { score, comment }) {
  const booking = await Booking.findOne({ _id: bookingId, driverUserId: driverUser._id });
  if (!booking) throw new AppError(404, 'Booking not found', 'NOT_FOUND');
  if (booking.status !== 'completed') throw new AppError(409, 'You can rate a rider after a completed trip', 'NOT_COMPLETED');
  const claimed = await Booking.findOneAndUpdate({ _id: bookingId, riderRated: { $ne: true } }, { $set: { riderRated: true } });
  if (!claimed) throw new AppError(409, 'You already rated this rider', 'ALREADY_RATED');

  await RiderRating.create({ bookingId, passengerId: booking.passengerId, driverUserId: driverUser._id, score, comment });
  const [agg] = await RiderRating.aggregate([
    { $match: { passengerId: booking.passengerId } },
    { $group: { _id: null, avg: { $avg: '$score' }, n: { $sum: 1 } } },
  ]);
  await User.updateOne({ _id: booking.passengerId }, { $set: { ratingAvg: Math.round(agg.avg * 100) / 100, ratingCount: agg.n } });
  return { ok: true };
}
