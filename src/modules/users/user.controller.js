import { asyncHandler } from '../../utils/asyncHandler.js';
import { env } from '../../config/env.js';
import { User } from './user.model.js';

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
