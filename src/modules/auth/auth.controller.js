import { asyncHandler } from '../../utils/asyncHandler.js';
import * as auth from './auth.service.js';

export const requestOtp = asyncHandler(async (req, res) => {
  await auth.requestOtp(req.body.phone);
  res.json({ message: 'Code sent' });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  res.json(await auth.verifyOtp(req.body));
});

export const refresh = asyncHandler(async (req, res) => {
  res.json(await auth.refresh(req.body.refreshToken));
});

export const logout = asyncHandler(async (req, res) => {
  await auth.logout(req.body.refreshToken);
  res.json({ message: 'Logged out' });
});

export const social = asyncHandler(async (req, res) => {
  res.json(await auth.socialLogin(req.body));
});

export const socialPhone = asyncHandler(async (req, res) => {
  res.json(await auth.socialLinkPhone(req.body));
});