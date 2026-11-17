import mongoose from 'mongoose';

const ref = (name) => ({ type: mongoose.Schema.Types.ObjectId, ref: name, required: true });

const bookingSchema = new mongoose.Schema(
  {
    passengerId: ref('User'),
    driverId: ref('Driver'),
    driverUserId: ref('User'),
    sessionId: ref('DriverSession'),
    routeId: ref('Route'),
    fromStopId: ref('Stop'),
    toStopId: ref('Stop'),
    seats: { type: Number, required: true, min: 1 },
    farePerSeat: { type: Number, required: true },
    fare: { type: Number, required: true },
    code: { type: String, required: true },
    status: {
      type: String,
      enum: ['confirmed', 'arriving', 'picked_up', 'completed', 'cancelled', 'no_show', 'expired'],
      default: 'confirmed',
    },
    active: { type: Boolean, default: true },
    paymentMethod: { type: String, enum: ['cash', 'transfer', 'wallet'], default: 'cash' },
    heldKobo: { type: Number, default: 0 },
    settledAt: Date,
    lateCancel: { type: Boolean, default: false }, // cancelled after the cab was arriving
    cancelFeeKobo: { type: Number, default: 0 },
    atStopAt: Date, // the rider tapped "I'm at the stop"
    paymentConfirmed: { type: Boolean, default: false },
    cancelledBy: { type: String, enum: ['passenger', 'driver', 'admin', 'system'] },
    cancelReason: String,
    shareToken: String,
    rated: { type: Boolean, default: false },
    riderRated: { type: Boolean, default: false },
    requestedAt: { type: Date, default: Date.now },
    confirmedAt: Date,
    arrivingAt: Date,
    pickedUpAt: Date,
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

bookingSchema.index({ passengerId: 1, status: 1 });
bookingSchema.index({ passengerId: 1, cancelledAt: -1 });
bookingSchema.index({ sessionId: 1, status: 1 });
bookingSchema.index({ driverId: 1, completedAt: -1 });
bookingSchema.index({ requestedAt: -1 });
bookingSchema.index(
  { passengerId: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_active_booking_per_passenger' }
);
bookingSchema.index(
  { sessionId: 1, code: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'unique_active_code_per_session' }
);
bookingSchema.index({ shareToken: 1 }, { unique: true, sparse: true });

export const Booking = mongoose.model('Booking', bookingSchema);
