import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    fromStopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
    days: { type: [Number], required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    active: { type: Boolean, default: true },
    lastSentAt: Date,
  },
  { timestamps: true }
);
alertSchema.index({ routeId: 1, active: 1 });
alertSchema.index({ userId: 1, routeId: 1, fromStopId: 1 }, { unique: true });

export const RouteAlert = mongoose.model('RouteAlert', alertSchema);
