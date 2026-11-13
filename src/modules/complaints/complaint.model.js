import mongoose from 'mongoose';

const complaintSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    commuteBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommuteBooking' },
    aboutUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      enum: ['safety', 'fare', 'driver_behaviour', 'rider_behaviour', 'harassment', 'no_show', 'cab_condition', 'other'],
      default: 'other',
    },
    message: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    resolution: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
  },
  { timestamps: true }
);

export const Complaint = mongoose.model('Complaint', complaintSchema);
