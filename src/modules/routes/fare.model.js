import mongoose from 'mongoose';

const fareSchema = new mongoose.Schema(
  {
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    fromStopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
    toStopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);
fareSchema.index({ routeId: 1, fromStopId: 1, toStopId: 1 }, { unique: true });

export const Fare = mongoose.model('Fare', fareSchema);
