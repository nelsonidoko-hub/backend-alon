import { asyncHandler } from '../../utils/asyncHandler.js';
import { env } from '../../config/env.js';
import { User } from './user.model.js';
import { AppError } from '../../utils/AppError.js';
import { requestOtp, consumeOtp } from '../auth/auth.service.js';

export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const { name, email, emergencyContact, notificationPrefs } = req.body;
  if (name) req.user.name = name;
  if (email) req.user.email = email;
  if (emergencyContact) req.user.emergencyContact = emergencyContact;
  if (notificationPrefs) {
    const current = req.user.notificationPrefs?.toObject?.() ?? req.user.notificationPrefs ?? {};
    req.user.notificationPrefs = { ...current, ...notificationPrefs };
  }
  await req.user.save();
  res.json({ user: req.user });
});

export const getPushKey = (_req, res) => {
  res.json({ publicKey: env.VAPID_PUBLIC_KEY || null });
};

export const savePushSubscription = asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body;
  await User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { endpoint } } });
  await User.updateOne({ _id: req.user._id }, { $push: { pushSubscriptions: { endpoint, keys } } });
  res.status(201).json({ message: 'Subscribed' });
});

export const removePushSubscription = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { endpoint: req.body.endpoint } } });
  res.json({ message: 'Unsubscribed' });
});

// Change the phone number on the account: a code goes to the NEW number, and the number only changes once the code is entered.
export const requestPhoneChange = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (phone === req.user.phone) throw new AppError(400, 'That is already your number', 'PHONE_SAME');
  if (await User.exists({ phone })) throw new AppError(409, 'That number is already used by another account', 'PHONE_TAKEN');
  await requestOtp(phone);
  res.json({ ok: true });
});

export const confirmPhoneChange = asyncHandler(async (req, res) => {
  const { phone, code } = req.body;
  if (await User.exists({ phone, _id: { $ne: req.user._id } })) {
    throw new AppError(409, 'That number is already used by another account', 'PHONE_TAKEN');
  }
  const proof = await consumeOtp(phone, code);
  if (proof.channel !== 'sms') throw new AppError(400, 'Use the code sent by SMS to the new number', 'OTP_INVALID');
  req.user.phone = phone;
  req.user.phoneVerifiedAt = new Date();
  await req.user.save();
  res.json({ user: req.user });
});
