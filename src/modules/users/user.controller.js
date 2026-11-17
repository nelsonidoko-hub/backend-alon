import { emailUser } from '../notifications/email.notify.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { env } from '../../config/env.js';
import { User } from './user.model.js';
import { AppError } from '../../utils/AppError.js';
import { requestOtp, consumeOtp, requestEmailChange, confirmEmailProof } from '../auth/auth.service.js';

export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const { name, emergencyContact, notificationPrefs } = req.body;
  if (name) req.user.name = name;
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
  const oldPhone = req.user.phone;
  req.user.phone = phone;
  req.user.phoneVerifiedAt = new Date();
  await req.user.save();
  emailUser(req.user._id, { subject: 'Your FoloRide phone number changed', heading: 'Phone number changed', lines: [`The phone number on your account was ${oldPhone ? 'changed' : 'added'}. If this was not you, contact FoloRide support right away.`], rows: [['New number', phone]] });
  res.json({ user: req.user });
});

// Add or change the email on the account: the code goes to the NEW email, and it is only saved once the code is entered.
export const requestEmailChangeCtl = asyncHandler(async (req, res) => {
  await requestEmailChange(req.user._id, req.body.email);
  res.json({ ok: true });
});

export const confirmEmailChangeCtl = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (await User.exists({ email, _id: { $ne: req.user._id } })) throw new AppError(409, 'That email is already used by another account', 'EMAIL_TAKEN');
  await confirmEmailProof(email, code);
  const oldEmail = req.user.email;
  req.user.email = email;
  await req.user.save();
  if (oldEmail) emailUser(req.user._id, { subject: 'Your FoloRide email changed', heading: 'Email changed', lines: ['The email on your account was changed. If this was not you, contact FoloRide support right away.'], rows: [['New email', email]], _to: oldEmail });
  emailUser(req.user._id, { subject: 'Email added to your FoloRide account', heading: 'Email confirmed', lines: ['You can now sign in to FoloRide with a code sent to this email.'] });
  res.json({ user: req.user });
});
