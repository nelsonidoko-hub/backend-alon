import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    online: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    seatsTotal: { type: Number, required: true, min: 1 },
    allowDrop: { type: Boolean, default: true }, // the driver accepts whole-cab bookings ("drops")
    seatsCapacity: Number, // passenger seats the vehicle has; offering fewer than this makes it a comfort ride
    seatsFree: { type: Number, required: true, min: 0 },
    lastLocation: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined },
    },
    lastHeading: Number,
    lastSpeed: Number,
    lastSeen: { type: Date, default: Date.now },
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
  },
  { timestamps: true }
);

sessionSchema.index({ routeId: 1, online: 1, lastSeen: -1 });
sessionSchema.index(
  { driverId: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_active_session_per_driver' }
);

export const DriverSession = mongoose.model('DriverSession', sessionSchema);
