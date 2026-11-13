import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { pageParams } from '../../utils/pagination.js';
import { idParams } from '../../utils/schemas.js';
import { env } from '../../config/env.js';
import * as s from './wallet.service.js';

const amount = z.object({ amount: z.number().int().min(100).max(500000) });
const verifySchema = z.object({ reference: z.string().min(6).max(80) });
const bankSchema = z.object({ bankCode: z.string().regex(/^\d{2,6}$/), accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits') });
const withdrawSchema = z.object({ amount: z.number().int().min(1).max(5000000), bankAccountId: z.string().regex(/^[a-f\d]{24}$/i) });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

export const walletRouter = Router();
walletRouter.use(authenticate, requireRole('passenger', 'driver'));
walletRouter.get('/', asyncHandler(async (req, res) => res.json(await s.walletView(req.user))));
walletRouter.get('/ledger', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
  const p = pageParams(req.query);
  res.json({ page: p.page, entries: await s.ledgerFor(req.user._id, p) });
}));
walletRouter.post('/topup', validate(amount), asyncHandler(async (req, res) => {
  res.status(201).json(await s.startTopup(req.user, req.body.amount));
}));
walletRouter.post('/topup/verify', validate(verifySchema), asyncHandler(async (req, res) => {
  res.json(await s.verifyTopup(req.user, req.body.reference));
}));
walletRouter.post('/dev-topup', validate(amount), asyncHandler(async (req, res) => {
  await s.devTopup(req.user, req.body.amount);
  res.json({ ok: true });
}));
walletRouter.get('/banks', asyncHandler(async (_req, res) => res.json({ banks: await s.listBanks() })));
walletRouter.get('/bank-accounts', asyncHandler(async (req, res) => res.json({ accounts: await s.listBankAccounts(req.user._id) })));
walletRouter.post('/bank-accounts', validate(bankSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ account: await s.addBankAccount(req.user, req.body) });
}));
walletRouter.delete('/bank-accounts/:id', validate(idParams, 'params'), asyncHandler(async (req, res) => {
  await s.removeBankAccount(req.user._id, req.params.id);
  res.json({ ok: true });
}));
walletRouter.post('/withdraw', validate(withdrawSchema), asyncHandler(async (req, res) => {
  const wd = await s.requestWithdrawal(req.user, { amountNaira: req.body.amount, bankAccountId: req.body.bankAccountId });
  res.status(201).json({ withdrawal: wd });
}));
walletRouter.get('/withdrawals', asyncHandler(async (req, res) => res.json({ withdrawals: await s.listWithdrawals(req.user._id) })));

export const webhookRouter = Router();
webhookRouter.post('/paystack', asyncHandler(async (req, res) => {
  if (!env.PAYSTACK_SECRET_KEY || !req.rawBody) throw new AppError(400, 'Not configured', 'BAD_REQUEST');
  const expected = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(req.rawBody).digest('hex');
  const given = String(req.headers['x-paystack-signature'] || '');
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) throw new AppError(401, 'Bad signature', 'BAD_SIGNATURE');
  await s.handlePaystackEvent(req.body);
  res.sendStatus(200);
}));

const adjustSchema = z.object({
  amountKobo: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero').refine((n) => Math.abs(n) <= 100000000),
  reason: z.string().trim().min(3).max(200),
});
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(200) });
const freezeSchema = z.object({ frozen: z.boolean() });
const statusQuery = z.object({ status: z.enum(['pending_review', 'processing', 'paid', 'failed', 'rejected']).optional() });

export const adminWalletRouter = Router();
adminWalletRouter.get('/summary', asyncHandler(async (_req, res) => res.json(await s.adminSummary())));
adminWalletRouter.get('/withdrawals', validate(statusQuery, 'query'), asyncHandler(async (req, res) => {
  res.json({ withdrawals: await s.adminListWithdrawals(req.query.status) });
}));
adminWalletRouter.post('/withdrawals/:id/approve', validate(idParams, 'params'), asyncHandler(async (req, res) => {
  res.json({ withdrawal: await s.adminApproveWithdrawal(req.params.id, req.user) });
}));
adminWalletRouter.post('/withdrawals/:id/reject', validate(idParams, 'params'), validate(rejectSchema), asyncHandler(async (req, res) => {
  res.json({ withdrawal: await s.adminRejectWithdrawal(req.params.id, req.user, req.body.reason) });
}));
adminWalletRouter.get('/users/:id', validate(idParams, 'params'), asyncHandler(async (req, res) => res.json(await s.adminUserWallet(req.params.id))));
adminWalletRouter.post('/users/:id/adjust', validate(idParams, 'params'), validate(adjustSchema), asyncHandler(async (req, res) => {
  await s.adminAdjust(req.user, req.params.id, req.body.amountKobo, req.body.reason);
  res.json(await s.adminUserWallet(req.params.id));
}));
adminWalletRouter.post('/users/:id/freeze', validate(idParams, 'params'), validate(freezeSchema), asyncHandler(async (req, res) => {
  res.json({ wallet: await s.adminFreeze(req.params.id, req.body.frozen) });
}));
