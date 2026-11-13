import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    name: { type: String, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    googleId: { type: String, index: { unique: true, sparse: true } },
    facebookId: { type: String, index: { unique: true, sparse: true } },
    role: { type: String, enum: ['passenger', 'driver', 'admin'], default: 'passenger' },
    status: { type: String, enum: ['active', 'blocked', 'deleted'], default: 'active' },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    phoneVerifiedAt: Date,
    emergencyContact: {
      name: { type: String, trim: true, maxlength: 80 },
      phone: String,
    },
    organization: {
      orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
      name: { type: String, trim: true, maxlength: 120 },
      staffId: { type: String, trim: true, maxlength: 40 },
      verified: { type: Boolean, default: false },
    },
    notificationPrefs: { sms: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: false } },
    pushSubscriptions: {
      type: [{ _id: false, endpoint: String, keys: { p256dh: String, auth: String } }],
      default: [],
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.pushSubscriptions;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);