import mongoose from 'mongoose';

const driverSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    driverType: { type: String, enum: ['taxi', 'staff'], default: 'taxi' },
    licenceNumber: { type: String, required: true, trim: true },
    licencePhotoKey: String,
    idPhotoKey: String,
    vehiclePapersKey: String,
    profilePhotoKey: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended', 'deleted'],
      default: 'pending',
      index: true,
    },
    rejectionReason: String,
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    totalTrips: { type: Number, default: 0 },
    cancelLockedUntil: { type: Date, default: null }, // set when the driver cancels too many bookings in a day
    cancelledTrips: { type: Number, default: 0 }, // bookings the driver cancelled before pickup
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
  },
  { timestamps: true }
);

export const Driver = mongoose.model('Driver', driverSchema);
