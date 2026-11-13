import mongoose from 'mongoose';

const { Schema } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name, required: true });
const pt = { _id: false, lat: { type: Number, required: true }, lng: { type: Number, required: true } };
const place = { _id: false, name: String, lat: { type: Number, required: true }, lng: { type: Number, required: true } };
const DIRECTION = { type: String, enum: ['to_work', 'from_work'], required: true };

const scheduleSchema = new Schema(
  {
    driverId: ref('Driver'),
    driverUserId: ref('User'),
    orgId: ref('Organization'),
    direction: DIRECTION,
    daysOfWeek: { type: [Number], required: true },
    timeOfDay: { type: String, required: true },
    home: place,
    waypoints: [pt],
    seatsTotal: { type: Number, required: true },
    pricePerSeat: { type: Number, default: 0 },
    durationMinutes: { type: Number, default: 30 },
    maxDetourMeters: { type: Number, default: 1000 },
    active: { type: Boolean, default: true },
    generatedUntil: Date,
  },
  { timestamps: true }
);
scheduleSchema.index({ driverUserId: 1, active: 1 });

const tripSchema = new Schema(
  {
    scheduleId: { type: Schema.Types.ObjectId, ref: 'CommuteSchedule' },
    driverId: ref('Driver'),
    driverUserId: ref('User'),
    orgId: ref('Organization'),
    direction: DIRECTION,
    departAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 30 },
    origin: place,
    destination: place,
    path: [pt],
    seatsTotal: { type: Number, required: true },
    seatsFree: { type: Number, required: true, min: 0 },
    pricePerSeat: { type: Number, default: 0 },
    maxDetourMeters: { type: Number, default: 1000 },
    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'completed', 'cancelled', 'expired'],
      default: 'scheduled',
    },
    reminded: { type: Boolean, default: false },
    lastLocation: { _id: false, lat: Number, lng: Number, at: Date },
    startedAt: Date,
    completedAt: Date,
    cancelReason: String,
  },
  { timestamps: true }
);
tripSchema.index({ orgId: 1, direction: 1, status: 1, departAt: 1 });
tripSchema.index({ driverUserId: 1, status: 1, departAt: 1 });
tripSchema.index(
  { scheduleId: 1, departAt: 1 },
  { unique: true, partialFilterExpression: { scheduleId: { $exists: true } }, name: 'one_trip_per_schedule_time' }
);

const bookingSchema = new Schema(
  {
    tripId: ref('CommuteTrip'),
    passengerId: ref('User'),
    driverUserId: ref('User'),
    orgId: ref('Organization'),
    pin: { _id: false, lat: { type: Number, required: true }, lng: { type: Number, required: true }, label: String },
    pinKind: { type: String, enum: ['pickup', 'dropoff'], required: true },
    distFromPathMeters: Number,
    estTime: Date,
    seats: { type: Number, default: 1 },
    pricePerSeat: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ['cash', 'wallet'], default: 'cash' },
    heldKobo: { type: Number, default: 0 },
    settledAt: Date,
    code: { type: String, required: true },
    status: {
      type: String,
      enum: ['confirmed', 'picked_up', 'completed', 'cancelled', 'no_show'],
      default: 'confirmed',
    },
    active: { type: Boolean, default: true },
    cancelledBy: { type: String, enum: ['passenger', 'driver', 'admin', 'system'] },
    cancelledAt: Date,
    pickedUpAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);
bookingSchema.index({ passengerId: 1, active: 1 });
bookingSchema.index({ tripId: 1, status: 1 });
bookingSchema.index(
  { tripId: 1, passengerId: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_active_booking_per_trip' }
);
bookingSchema.index(
  { tripId: 1, code: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'unique_active_code_per_trip' }
);

export const CommuteSchedule = mongoose.model('CommuteSchedule', scheduleSchema);
export const CommuteTrip = mongoose.model('CommuteTrip', tripSchema);
export const CommuteBooking = mongoose.model('CommuteBooking', bookingSchema);
