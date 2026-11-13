import mongoose from 'mongoose';

const stopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point', required: true },
      coordinates: { type: [Number], required: true },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
stopSchema.index({ location: '2dsphere' });

export const Stop = mongoose.model('Stop', stopSchema);
