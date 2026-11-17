import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { User } from '../users/user.model.js';
import { sendSms } from '../notifications/sms.service.js';
import { sendEmail } from '../notifications/email.service.js';
import { emailUser, appLink } from '../notifications/email.notify.js';

// Sent once when an account is first created (only if it has an email).
export function welcomeEmail(user) {
  const driver = user.role === 'driver';
  emailUser(user._id, {
    subject: 'Welcome to FoloRide',
    heading: `Welcome to FoloRide${user.name ? `, ${user.name.split(' ')[0]}` : ''}`,
    lines: driver
      ? ['Your driver account is created. Finish your application (licence, vehicle and photos) so our team can approve you. We will email you as soon as it is reviewed.']
      : ['Your account is ready. Pick your stop, choose a cab and book a seat on a shared ride across Abuja.', 'Add money to your wallet for cashless rides, or pay the driver in cash.'],
    button: { label: driver ? 'Complete my application' : 'Book a ride', url: appLink(user.role) },
  });
}
import { whatsappSendOtp } from '../whatsapp/whatsapp.notify.js'; // FEATURE: WHATSAPP
import { Otp } from './otp.model.js';
import { RefreshToken } from './refreshToken.model.js';
import { verifyProvider } from './social.js';

const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 60 * 1000;

const hashOtp = (phone, code) =>
  crypto.createHmac('sha256', env.OTP_SECRET).update(`${phone}:${code}`).digest('hex');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function storeCode(phone, channel = 'sms', email) {
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
      channel,
      email: channel === 'email' ? email : undefined,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
    },
    { upsert: true }
  );
  return code;
}

const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, (_m, a, b) => `${a}***${b}`);

export const emailKey = (email) => `e:${email}`;

async function mailCode(email) {
  const code = await storeCode(emailKey(email), 'email', email);
  const sent = await sendEmail(email, 'Your FoloRide code', `Your FoloRide code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. If you did not ask for it, ignore this email.`);
  if (!sent) {
    await Otp.deleteOne({ phone: emailKey(email) });
    throw new AppError(502, 'Could not send the email. Try again shortly', 'EMAIL_FAILED');
  }
  return { sentTo: maskEmail(email) };
}

// Sends a code to an email for a signed-in person who wants to add or change the email on their account.
export async function requestEmailChange(userId, email) {
  if (await User.exists({ email, _id: { $ne: userId } })) throw new AppError(409, 'That email is already used by another account', 'EMAIL_TAKEN');
  return mailCode(email);
}

export async function confirmEmailProof(email, code) {
  const proof = await consumeOtp(emailKey(email), code);
  if (proof.channel !== 'email') throw new AppError(400, 'Invalid code', 'OTP_INVALID');
}

/**
 * Email sign-in: type your email and the code is sent there. A new passenger's account is made when the code is entered.
 * New accounts have no phone until the person adds one (and proves it by SMS) in their profile.
 */
export async function requestEmailOtp({ email }) {
  const user = await User.findOne({ email });
  if (user) {
    if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
  }
  return mailCode(email);
}

export async function verifyEmailOtp({ email, code, name, role }) {
  await consumeOtp(emailKey(email), code, { keep: true });
  let user = await User.findOne({ email });
  if (user) {
    if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
    if (name && !user.name) user.name = name;
    await user.save();
  } else {
    user = await User.create({ name, email, role: role === 'driver' ? 'driver' : 'passenger' });
    welcomeEmail(user);
  }
  await Otp.deleteOne({ phone: emailKey(email) });
  const tokens = await issueTokens(user);
  return { user, ...tokens };
}

export async function requestOtp(phone) {
  const code = await storeCode(phone, 'sms');
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
export async function consumeOtp(phone, code, { keep = false } = {}) {
  const otp = await Otp.findOne({ phone });
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
  const result = { channel: otp.channel || 'sms', email: otp.email };
  if (!keep) await otp.deleteOne(); // keep: the caller deletes it once the account step has worked, so a server error does not waste the code
  return result;
}

export async function verifyOtp({ phone, code, name, role }) {
  const { channel, email } = await consumeOtp(phone, code, { keep: true });

  let user = await User.findOne({ phone });
  if (user) {
    if (user.status === 'blocked') throw new AppError(403, 'Account blocked', 'BLOCKED');
    if (name && !user.name) user.name = name;
    if (channel === 'sms') {
      if (!user.phoneVerifiedAt) {
        // The account was opened with an email code and nobody had proved they hold this number. Someone just did,
        // so they own the account now: drop the old email and every old login.
        user.email = undefined;
        await RefreshToken.deleteMany({ userId: user._id });
      }
      user.phoneVerifiedAt = user.phoneVerifiedAt || new Date();
    }
    await user.save();
  } else {
    user = await User.create({
      phone,
      name,
      role: channel === 'email' ? 'passenger' : role || 'passenger',
      ...(channel === 'email' ? { email } : { phoneVerifiedAt: new Date() }),
    });
  }

  await Otp.deleteOne({ phone });
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
  const proof = await consumeOtp(phone, code);
  if (proof.channel !== 'sms') throw new AppError(400, 'Use the code sent by SMS to add your phone number', 'OTP_INVALID');

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
    welcomeEmail(user);
  }
  return { user, ...(await issueTokens(user)) };
}
