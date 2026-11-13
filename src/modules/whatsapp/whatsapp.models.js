import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    pendingName: { type: Boolean, default: false },
    optedOut: { type: Boolean, default: false },
    lastInboundAt: Date,
  },
  { timestamps: true }
);

// Meta sends the same message more than once if we are slow. This remembers message ids for a week.
const messageSchema = new mongoose.Schema(
  { mid: { type: String, required: true, unique: true }, createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 } },
  { versionKey: false }
);

export const WaContact = mongoose.model('WaContact', contactSchema);
export const WaMessage = mongoose.model('WaMessage', messageSchema);
