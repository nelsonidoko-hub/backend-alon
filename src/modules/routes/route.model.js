import mongoose from 'mongoose';

const routeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    stops: [
      {
        _id: false,
        stopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
        order: { type: Number, required: true },
      },
    ],
    path: {
      type: { type: String, enum: ['LineString'] },
      coordinates: { type: [[Number]], default: undefined },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Route = mongoose.model('Route', routeSchema);
