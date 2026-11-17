import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { User } from '../users/user.model.js';
import { sendSms } from '../notifications/sms.service.js';
import { whatsappSendOtp } from '../whatsapp/whatsapp.notify.js'; // FEATURE: WHATSAPP
import { Otp } from './otp.model.js';
import { RefreshToken } from './refreshToken.model.js';
import { verifyProvider } from './social.js';

const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 60 * 1000;

const hashOtp = (phone, code) =>
  crypto.createHmac('sha256', env.OTP_SECRET).update(`${phone}:${code}`).digest('hex');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function requestOtp(phone) {
  const existing = await Otp.findOne({ phone });
  if (existing && Date.now() - existing.createdAt.getTime() < RESEND_AFTER_MS) {
    throw new AppError(429, 'Please wait a minute before requesting another code', 'OTP_TOO_SOON');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await Otp.findOneAndUpdate(
    { phone },
    {
      codeHash: hashOtp(phone, code),
      attempts: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
    },
    { upsert: true }
  );
  // >>> FEATURE: WHATSAPP (start). With OTP_CHANNEL=whatsapp the code goes to WhatsApp first, then SMS if that fails.
  let sent = env.OTP_CHANNEL === 'whatsapp' ? await whatsappSendOtp(phone, code) : false;
  // <<< FEATURE: WHATSAPP (end)
  if (!sent) sent = await sendSms(phone, `Your FoloRide code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes.`);
  if (!sent) {
    await Otp.deleteOne({ phone });
    throw new AppError(502, 'Could not send the SMS. Try again shortly', 'SMS_FAILED');
  }
}

async function issueTokens(user) {
  const accessToken = jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: String(user._id),
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
  const refreshToken = crypto.randomBytes(48).toString('hex');
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
  });
  return { accessToken, refreshToken };
}

/** Checks a login code and uses it up. Throws if it is wrong, expired or locked. */
export async function consumeOtp(phone, code) {  const otp = await Otp.findOne({ phone });
  if (!otp || otp.expiresAt < new Date()) {
    throw new AppError(400, 'Code expired or not found', 'OTP_INVALID');
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    await otp.deleteOne();
    throw new AppError(429, 'Too many attempts. Request a new code', 'OTP_LOCKED');
  }

  const expected = Buffer.from(otp.codeHash);
  const actual = Buffer.from(hashOtp(phone, code));
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!ok) {
    otp.attempts += 1;
    await otp.save();
    throw new AppError(400, 'Incorrect code', 'OTP_INVALID');
  }
  await otp.deleteOne();
}

export async function verifyOtp({ phone, code, name, role }) {
  await consumeOtp(phone, code);

  let user = await User.findOne({ phone });
  if (user) {
    if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
    if (name && !user.name) user.name = name;
    user.phoneVerifiedAt = user.phoneVerifiedAt || new Date();
    await user.save();
  } else {
    user = await User.create({ phone, name, role: role || 'passenger', phoneVerifiedAt: new Date() });
  }

  const tokens = await issueTokens(user);
  return { user, ...tokens };
}

export async function refresh(rawToken) {
  const record = await RefreshToken.findOneAndDelete({ tokenHash: hashToken(rawToken) });
  if (!record || record.expiresAt < new Date()) {
    throw new AppError(401, 'Invalid refresh token', 'INVALID_TOKEN');
  }
  const user = await User.findById(record.userId);
  if (!user) throw new AppError(401, 'User not found', 'UNAUTHENTICATED');
  if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
  return issueTokens(user);
}

export async function logout(rawToken) {
  await RefreshToken.deleteOne({ tokenHash: hashToken(rawToken) });
}

// ---- Sign in with Google / Facebook ----
// A person who has used a provider before goes straight in. A new person confirms their phone number once
// (the same code as always), so every account still has a verified number for trip messages and safety.
const idField = (provider) => (provider === 'google' ? 'googleId' : 'facebookId');

export async function socialLogin({ provider, token, role }) {
  const who = await verifyProvider(provider, token);
  const user = await User.findOne({ [idField(provider)]: who.id });
  if (user) {
    if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
    return { user, ...(await issueTokens(user)) };
  }
  // Not linked yet: hand back a short-lived pass that is only good for adding a phone number.
  // It is signed with OTP_SECRET (not JWT_SECRET) so it can never be used as a login token.
  const signupToken = jwt.sign({ purpose: 'social-signup', provider, id: who.id, name: who.name, email: who.email, role: role || 'passenger' }, env.OTP_SECRET, { expiresIn: '15m' });
  return { needPhone: true, signupToken, name: who.name || '' };
}

export async function socialLinkPhone({ signupToken, phone, code }) {
  let claim;
  try {
    claim = jwt.verify(signupToken, env.OTP_SECRET);
  } catch {
    throw new AppError(401, 'This sign-in expired. Start again', 'SOCIAL_EXPIRED');
  }
  if (claim.purpose !== 'social-signup') throw new AppError(401, 'This sign-in expired. Start again', 'SOCIAL_EXPIRED');
  await consumeOtp(phone, code);

  const field = idField(claim.provider);
  let user = await User.findOne({ phone });
  if (user) {
    if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
    if (user[field] && user[field] !== claim.id) throw new AppError(409, 'This number is already linked to another account', 'SOCIAL_CONFLICT');
    user[field] = claim.id;
    if (!user.name && claim.name) user.name = claim.name;
    if (!user.email && claim.email) user.email = claim.email;
    user.phoneVerifiedAt = user.phoneVerifiedAt || new Date();
    await user.save();
  } else {
    user = await User.create({
      phone,
      name: claim.name?.slice(0, 80),
      email: claim.email,
      role: claim.role === 'driver' ? 'driver' : 'passenger',
      [field]: claim.id,
      phoneVerifiedAt: new Date(),
    });
  }
  return { user, ...(await issueTokens(user)) };
}
