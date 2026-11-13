import mongoose from 'mongoose';

const sosSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    commuteBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommuteBooking' },
    location: { lat: Number, lng: Number },
    note: { type: String, maxlength: 300 },
    status: { type: String, enum: ['open', 'handled'], default: 'open', index: true },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handledAt: Date,
  },
  { timestamps: true }
);

export const SosAlert = mongoose.model('SosAlert', sosSchema);
