import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true, index: true },
    score: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 300 },
  },
  { timestamps: true }
);

export const Rating = mongoose.model('Rating', ratingSchema);
