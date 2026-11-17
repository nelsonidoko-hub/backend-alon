import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  channel: { type: String, default: 'sms' }, // 'sms' proves the person holds the phone; 'email' does not
  signupPhone: String, // phone a new email-signup gave
  email: String, // where an email code was sent
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

export const Otp = mongoose.model('Otp', otpSchema);
