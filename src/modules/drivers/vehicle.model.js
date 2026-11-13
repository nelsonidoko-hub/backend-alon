import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema(
  {
    plate: { type: String, required: true, unique: true, uppercase: true, trim: true },
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    colour: { type: String, required: true, trim: true },
    year: Number,
    seatCapacity: { type: Number, required: true, min: 1, max: 8 },
  },
  { timestamps: true }
);

export const Vehicle = mongoose.model('Vehicle', vehicleSchema);
