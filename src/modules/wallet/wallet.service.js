import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Wallet, LedgerEntry, Topup, BankAccount, Withdrawal } from './wallet.models.js';
import { Booking } from '../bookings/booking.model.js';
import { CommuteBooking } from '../commute/commute.models.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { paystack, paymentsEnabled, PaystackError } from './paystack.service.js';
import { env, riderUrl } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

export const toKobo = (naira) => Math.round(naira * 100);
const naira = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

/* ---------- core ledger ---------- */

async function withTx(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (e) {
    if (e?.code === 11000 && e.keyPattern?.ref) return { duplicate: true };
    throw e;
  } finally {
    await session.endSession();
  }
}

export async function ensureWallet(userId) {
  const q = { userId };
  const upsert = { upsert: true, new: true };
  try {
    return await Wallet.findOneAndUpdate(q, { $setOnInsert: { status: 'active' } }, upsert);
  } catch (e) {
    if (e.code === 11000) return Wallet.findOne(q);
    throw e;
  }
}

async function ensurePlatformWallet() {
  const q = { isPlatform: true };
  try {
    return await Wallet.findOneAndUpdate(q, { $setOnInsert: { status: 'active' } }, { upsert: true, new: true });
  } catch (e) {
    if (e.code === 11000) return Wallet.findOne(q);
    throw e;
  }
}

/** Moves money on one wallet and writes the ledger line. Must run inside withTx. */
async function post(session, walletQuery, { type, amount = 0, held = 0, ref, meta, allowFrozen = false }) {
  const filter = { ...walletQuery };
  if (amount < 0) filter.balance = { $gte: -amount };
  if (held < 0) filter.held = { $gte: -held };
  if (!allowFrozen && (amount < 0 || held > 0)) filter.status = 'active';
  const w = await Wallet.findOneAndUpdate(filter, { $inc: { balance: amount, held } }, { new: true, session });
  if (!w) throw new AppError(402, 'Not enough money in the wallet, or the wallet is frozen', 'INSUFFICIENT_FUNDS');
  await LedgerEntry.create(
    [{ walletId: w._id, userId: w.userId, type, amount, held, balanceAfter: w.balance, heldAfter: w.held, ref, meta }],
    { session }
  );
  return w;
}

/* ---------- user views ---------- */

export async function walletView(user) {
  const w = await ensureWallet(user._id);
  return {
    balance: w.balance,
    held: w.held,
    status: w.status,
    currency: 'NGN',
    paymentsEnabled: paymentsEnabled(),
    devTopup: !paymentsEnabled() && env.NODE_ENV !== 'production',
    canWithdraw: user.role === 'driver',
    minWithdrawal: env.MIN_WITHDRAWAL_KOBO,
    withdrawalFee: env.WITHDRAWAL_FEE_KOBO,
    commissionPercent: env.COMMISSION_PERCENT,
  };
}

export async function ledgerFor(userId, { skip, limit }) {
  const rows = await LedgerEntry.find({ userId }).sort('-createdAt').skip(skip).limit(limit).lean();
  return rows.map((r) => ({
    id: String(r._id),
    type: r.type,
    amount: r.amount,
    held: r.held,
    balanceAfter: r.balanceAfter,
    createdAt: r.createdAt,
    kind: r.meta?.kind,
    charge: r.meta?.charge,
  }));
}

/* ---------- top-ups ---------- */

export async function startTopup(user, amountNaira) {
  const reference = `alg-${crypto.randomBytes(10).toString('hex')}`;
  const amountKobo = toKobo(amountNaira);
  await ensureWallet(user._id);
  const d = await paystack('/transaction/initialize', {
    method: 'POST',
    body: {
      email: `${user._id}@wallet.along.app`,
      amount: amountKobo,
      reference,
      currency: 'NGN',
      callback_url: `${riderUrl}/wallet`,
      metadata: { userId: String(user._id) },
    },
  });
  await Topup.create({ userId: user._id, reference, amountKobo });
  return { authorizationUrl: d.data.authorization_url, reference };
}

export async function creditTopup(reference, data) {
  const topup = await Topup.findOne({ reference });
  if (!topup) return { ignored: true };
  if (topup.status === 'success') return { duplicate: true };
  if (data.amount !== topup.amountKobo || (data.currency && data.currency !== 'NGN')) {
    await Topup.updateOne({ _id: topup._id }, { $set: { status: 'failed' } });
    logger.error({ reference, expected: topup.amountKobo, got: data.amount }, 'Top-up amount mismatch');
    return { mismatch: true };
  }
  await ensureWallet(topup.userId);
  const result = await withTx(async (session) => {
    const t = await Topup.findOneAndUpdate(
      { _id: topup._id, status: 'pending' },
      { $set: { status: 'success', paidAt: new Date(), channel: data.channel } },
      { session }
    );
    if (!t) return { duplicate: true };
    await post(session, { userId: topup.userId }, { type: 'topup', amount: topup.amountKobo, ref: `topup:${reference}`, meta: { reference } });
    return { ok: true };
  });
  if (result.ok) {
    notifyUser(topup.userId, 'wallet:updated', { reason: 'topup' }, { title: 'Wallet topped up', body: `${naira(topup.amountKobo)} was added to your FoloRide wallet.` });
  }
  return result;
}

export async function verifyTopup(user, reference) {
  const topup = await Topup.findOne({ reference, userId: user._id });
  if (!topup) throw new AppError(404, 'Top-up not found', 'NOT_FOUND');
  if (topup.status === 'success') return { status: 'success' };
  const d = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (d.data.status === 'success') {
    await creditTopup(reference, d.data);
    return { status: 'success' };
  }
  return { status: d.data.status };
}

export async function devTopup(user, amountNaira) {
  if (paymentsEnabled() || env.NODE_ENV === 'production') {
    throw new AppError(403, 'Test top-ups are not available', 'FORBIDDEN');
  }
  await ensureWallet(user._id);
  await withTx((session) =>
    post(session, { userId: user._id }, { type: 'topup', amount: toKobo(amountNaira), ref: `devtopup:${crypto.randomBytes(8).toString('hex')}`, meta: { dev: true } })
  );
}

/* ---------- holds and settlement ---------- */

export async function holdFunds({ userId, kobo, kind, refId }) {
  await ensureWallet(userId);
  await withTx((session) =>
    post(session, { userId }, { type: 'hold', amount: -kobo, held: kobo, ref: `hold:${kind}:${refId}`, meta: { kind, refId } })
  );
}

async function settle({ kind, refId, passengerId, driverUserId, heldKobo, chargeKobo, commissionPercent, reason }) {
  if (!heldKobo) return null;
  const charge = Math.min(Math.max(chargeKobo, 0), heldKobo);
  const release = heldKobo - charge;
  const commission = Math.floor((charge * commissionPercent) / 100);
  const earning = charge - commission;
  const base = `settle:${kind}:${refId}`;
  const meta = { kind, refId, charge, release, reason };

  await ensureWallet(passengerId);
  if (charge > 0) {
    await ensureWallet(driverUserId);
    if (commission > 0) await ensurePlatformWallet();
  }
  const result = await withTx(async (session) => {
    await post(session, { userId: passengerId }, {
      type: charge > 0 ? 'payment' : 'hold_release',
      amount: release,
      held: -heldKobo,
      ref: `${base}:rider`,
      meta,
    });
    if (earning > 0) await post(session, { userId: driverUserId }, { type: 'earning', amount: earning, ref: `${base}:driver`, meta, allowFrozen: true });
    if (commission > 0) await post(session, { isPlatform: true }, { type: 'commission', amount: commission, ref: `${base}:platform`, meta, allowFrozen: true });
    return { charge, release, commission, earning };
  });
  return result;
}

export const releaseHold = ({ userId, driverUserId, kind, refId, kobo }) =>
  settle({ kind, refId, passengerId: userId, driverUserId, heldKobo: kobo, chargeKobo: 0, commissionPercent: 0, reason: 'released' });

/** Settles a finished booking: full fare if completed, a fee if no-show, otherwise a full release. */
export async function settleBookingDoc(kind, b) {
  if (!b || !b.heldKobo || b.settledAt) return null;
  const doc = b.toObject ? b.toObject() : b;
  const charge =
    doc.status === 'completed'
      ? doc.heldKobo
      : doc.status === 'cancelled' && doc.cancelFeeKobo > 0
        ? doc.cancelFeeKobo
      : doc.status === 'no_show'
        ? Math.floor((doc.heldKobo * env.NO_SHOW_FEE_PERCENT) / 100)
        : 0;
  try {
    const r = await settle({
      kind,
      refId: String(doc._id),
      passengerId: doc.passengerId,
      driverUserId: doc.driverUserId,
      heldKobo: doc.heldKobo,
      chargeKobo: charge,
      commissionPercent: kind === 'ride' ? env.COMMISSION_PERCENT : env.COMMUTE_COMMISSION_PERCENT,
      reason: doc.status,
    });
    await (kind === 'ride' ? Booking : CommuteBooking).updateOne({ _id: doc._id }, { $set: { settledAt: new Date() } });
    if (r && !r.duplicate && r.earning > 0) notifyUser(doc.driverUserId, 'wallet:updated', { reason: 'earning', amount: r.earning });
    if (r && !r.duplicate) notifyUser(doc.passengerId, 'wallet:updated', { reason: doc.status });
    return r;
  } catch (err) {
    logger.error({ err, kind, id: String(doc._id) }, 'Settlement failed, it will be retried');
    return null;
  }
}

export async function reconcileSettlements() {
  const cutoff = new Date(Date.now() - 60 * 1000);
  const base = { heldKobo: { $gt: 0 }, settledAt: null, updatedAt: { $lt: cutoff } };
  const rides = await Booking.find({ ...base, status: { $in: ['completed', 'cancelled', 'no_show', 'expired'] } }).limit(50);
  const commutes = await CommuteBooking.find({ ...base, status: { $in: ['completed', 'cancelled', 'no_show'] } }).limit(50);
  for (const b of rides) await settleBookingDoc('ride', b);
  for (const b of commutes) await settleBookingDoc('commute', b);
  return rides.length + commutes.length;
}

/* ---------- bank accounts ---------- */

let bankCache = { at: 0, list: [] };

export async function listBanks() {
  if (Date.now() - bankCache.at < 24 * 60 * 60 * 1000 && bankCache.list.length) return bankCache.list;
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const d = await paystack(`/bank?country=nigeria&perPage=100&page=${page}`);
    all.push(...d.data.filter((b) => b.active !== false && b.currency === 'NGN'));
    if (d.data.length < 100) break;
  }
  bankCache = { at: Date.now(), list: all.map((b) => ({ name: b.name, code: b.code })).sort((a, b) => a.name.localeCompare(b.name)) };
  return bankCache.list;
}

export const listBankAccounts = (userId) => BankAccount.find({ userId, active: true }).sort('-createdAt').lean();

export async function addBankAccount(user, { bankCode, accountNumber }) {
  if ((await BankAccount.countDocuments({ userId: user._id, active: true })) >= 3) {
    throw new AppError(409, 'You can save up to 3 bank accounts', 'TOO_MANY_ACCOUNTS');
  }
  const resolved = await paystack(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
  const accountName = resolved.data.account_name;
  const rec = await paystack('/transferrecipient', {
    method: 'POST',
    body: { type: 'nuban', name: accountName, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' },
  });
  const bank = (await listBanks().catch(() => [])).find((b) => b.code === bankCode);
  return BankAccount.findOneAndUpdate(
    { userId: user._id, recipientCode: rec.data.recipient_code },
    { $set: { bankCode, bankName: bank?.name, accountLast4: accountNumber.slice(-4), accountName, active: true } },
    { upsert: true, new: true }
  );
}

export async function removeBankAccount(userId, id) {
  const r = await BankAccount.updateOne({ _id: id, userId }, { $set: { active: false } });
  if (!r.matchedCount) throw new AppError(404, 'Bank account not found', 'NOT_FOUND');
}

/* ---------- withdrawals ---------- */

export async function requestWithdrawal(user, { amountNaira, bankAccountId }) {
  if (user.role !== 'driver') throw new AppError(403, 'Only drivers can withdraw', 'FORBIDDEN');
  const amountKobo = toKobo(amountNaira);
  if (amountKobo < env.MIN_WITHDRAWAL_KOBO) {
    throw new AppError(400, `The minimum withdrawal is ${naira(env.MIN_WITHDRAWAL_KOBO)}`, 'BELOW_MINIMUM');
  }
  const bank = await BankAccount.findOne({ _id: bankAccountId, userId: user._id, active: true });
  if (!bank) throw new AppError(404, 'Bank account not found', 'NOT_FOUND');
  await ensureWallet(user._id);

  const wdId = new mongoose.Types.ObjectId();
  const fee = env.WITHDRAWAL_FEE_KOBO;
  await withTx(async (session) => {
    await post(session, { userId: user._id }, { type: 'withdrawal', amount: -(amountKobo + fee), ref: `wd:${wdId}`, meta: { withdrawalId: String(wdId) } });
    await Withdrawal.create([{ _id: wdId, userId: user._id, bankAccountId: bank._id, amountKobo, feeKobo: fee }], { session });
  });
  if (env.WITHDRAWAL_MODE === 'auto') await payout(wdId, null).catch((err) => logger.error({ err }, 'Auto payout failed'));
  return Withdrawal.findById(wdId);
}

export const listWithdrawals = (userId) =>
  Withdrawal.find({ userId }).sort('-createdAt').limit(30).populate('bankAccountId', 'bankName accountLast4 accountName').lean();

async function payout(wdId, admin) {
  const wd = await Withdrawal.findOneAndUpdate(
    { _id: wdId, status: 'pending_review' },
    { $set: { status: 'processing', approvedBy: admin?._id, approvedAt: new Date() } },
    { new: true }
  );
  if (!wd) throw new AppError(409, 'This withdrawal is not waiting for approval', 'INVALID_STATE');
  const bank = await BankAccount.findById(wd.bankAccountId);
  try {
    const d = await paystack('/transfer', {
      method: 'POST',
      body: { source: 'balance', amount: wd.amountKobo, recipient: bank.recipientCode, reason: 'FoloRide earnings', reference: `wd_${wd._id}` },
    });
    await Withdrawal.updateOne({ _id: wd._id }, { $set: { transferCode: d.data.transfer_code, providerStatus: d.data.status } });
    if (d.data.status === 'success') await markPaid(wd._id);
  } catch (e) {
    if (e instanceof PaystackError && e.definite) await failWithdrawal(wd._id, e.message, 'failed');
    else logger.error({ err: e, id: String(wd._id) }, 'Transfer outcome unknown. Check Paystack before retrying');
    throw e;
  }
  return Withdrawal.findById(wd._id);
}

async function markPaid(wdId) {
  const wd = await Withdrawal.findOneAndUpdate({ _id: wdId, status: 'processing' }, { $set: { status: 'paid', paidAt: new Date() } }, { new: true });
  if (wd) notifyUser(wd.userId, 'wallet:updated', { reason: 'withdrawal_paid' }, { title: 'Withdrawal sent', body: `${naira(wd.amountKobo)} is on its way to your bank.`, sms: true });
}

async function failWithdrawal(wdId, reason, status) {
  const result = await withTx(async (session) => {
    const wd = await Withdrawal.findOneAndUpdate(
      { _id: wdId, status: { $in: ['pending_review', 'processing'] } },
      { $set: { status, failureReason: reason } },
      { new: true, session }
    );
    if (!wd) return { duplicate: true };
    await post(session, { userId: wd.userId }, { type: 'withdrawal_reversal', amount: wd.amountKobo + wd.feeKobo, ref: `wd-rev:${wdId}`, meta: { withdrawalId: String(wdId), reason }, allowFrozen: true });
    return { wd };
  });
  if (result.wd) notifyUser(result.wd.userId, 'wallet:updated', { reason: 'withdrawal_failed' }, { title: 'Withdrawal not completed', body: `${naira(result.wd.amountKobo)} was returned to your wallet. ${reason}`, sms: true });
}

export const adminApproveWithdrawal = (id, admin) => payout(id, admin);

export async function adminRejectWithdrawal(id, admin, reason) {
  const wd = await Withdrawal.findOne({ _id: id, status: 'pending_review' });
  if (!wd) throw new AppError(409, 'This withdrawal is not waiting for approval', 'INVALID_STATE');
  await failWithdrawal(id, reason, 'rejected');
  return Withdrawal.findById(id);
}

export async function handlePaystackEvent(event) {
  const { event: type, data } = event;
  if (type === 'charge.success' && data?.reference) return creditTopup(data.reference, data);
  const ref = data?.reference || '';
  if (!ref.startsWith('wd_')) return { ignored: true };
  const id = ref.slice(3);
  if (type === 'transfer.success') return markPaid(id);
  if (type === 'transfer.failed' || type === 'transfer.reversed') return failWithdrawal(id, 'The bank transfer failed.', 'failed');
  return { ignored: true };
}

/* ---------- admin ---------- */

export async function adminSummary() {
  const [users, platform, pending, topups] = await Promise.all([
    Wallet.aggregate([{ $match: { isPlatform: { $ne: true } } }, { $group: { _id: null, balance: { $sum: '$balance' }, held: { $sum: '$held' }, wallets: { $sum: 1 } } }]),
    Wallet.findOne({ isPlatform: true }).lean(),
    Withdrawal.aggregate([{ $match: { status: { $in: ['pending_review', 'processing'] } } }, { $group: { _id: '$status', count: { $sum: 1 }, kobo: { $sum: '$amountKobo' } } }]),
    Topup.aggregate([{ $match: { status: 'success', paidAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }, { $group: { _id: null, kobo: { $sum: '$amountKobo' }, count: { $sum: 1 } } }]),
  ]);
  return {
    userBalances: users[0]?.balance || 0,
    userHeld: users[0]?.held || 0,
    wallets: users[0]?.wallets || 0,
    platformEarnings: platform?.balance || 0,
    pendingWithdrawals: Object.fromEntries(pending.map((p) => [p._id, { count: p.count, kobo: p.kobo }])),
    topupsLast24h: { count: topups[0]?.count || 0, kobo: topups[0]?.kobo || 0 },
  };
}

export const adminListWithdrawals = (status) =>
  Withdrawal.find(status ? { status } : {})
    .sort('-createdAt')
    .limit(100)
    .populate('userId', 'name phone')
    .populate('bankAccountId', 'bankName accountLast4 accountName')
    .lean();

export async function adminUserWallet(userId) {
  const w = await ensureWallet(userId);
  const entries = await LedgerEntry.find({ userId }).sort('-createdAt').limit(40).lean();
  return { wallet: w, entries };
}

export async function adminAdjust(admin, userId, amountKobo, reason) {
  await ensureWallet(userId);
  await withTx((session) =>
    post(session, { userId }, { type: 'adjustment', amount: amountKobo, ref: `adj:${new mongoose.Types.ObjectId()}`, meta: { reason, by: String(admin._id) }, allowFrozen: true })
  );
  notifyUser(userId, 'wallet:updated', { reason: 'adjustment' }, { title: 'Wallet updated', body: `${naira(Math.abs(amountKobo))} was ${amountKobo > 0 ? 'added to' : 'taken from'} your wallet by FoloRide support.` });
}

export async function adminFreeze(userId, frozen) {
  await ensureWallet(userId);
  return Wallet.findOneAndUpdate({ userId }, { $set: { status: frozen ? 'frozen' : 'active' } }, { new: true });
}
