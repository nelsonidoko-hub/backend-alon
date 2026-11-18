import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema(
  {
    plate: { type: String, required: true, unique: true, uppercase: true, trim: true },
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    colour: { type: String, required: true, trim: true },
    year: Number,
    seatCapacity: { type: Number, required: true, min: 1, max: 60 },
    // car (Corolla, Camry...), minivan (Sienna, Hiace van...), bus (14-24 seats), coach (long bus). Riders see it on the cab.
    kind: { type: String, enum: ['car', 'minivan', 'bus', 'coach'] },
  },
  { timestamps: true }
);

export const Vehicle = mongoose.model('Vehicle', vehicleSchema);

/** The vehicle type riders see. Older vehicles have none saved, so it is guessed from the seat count. */
export function vehicleKind(v) {
  if (!v) return 'car';
  if (v.kind) return v.kind;
  const n = v.seatCapacity || 4;
  return n <= 5 ? 'car' : n <= 9 ? 'minivan' : n <= 24 ? 'bus' : 'coach';
}
