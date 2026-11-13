import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    joinCode: { type: String, required: true, unique: true, uppercase: true },
    location: { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
    address: { type: String, trim: true, maxlength: 200 },
    autoVerify: { type: Boolean, default: false },
    maxPricePerSeat: { type: Number, default: 1500, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Organization = mongoose.model('Organization', organizationSchema);
