import mongoose from 'mongoose';

const { Schema } = mongoose;
const id = (ref, required = true) => ({ type: Schema.Types.ObjectId, ref, required });

// All money is stored as integer kobo (100 kobo = 1 naira).
const walletSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    isPlatform: Boolean,
    balance: { type: Number, default: 0 },
    held: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'frozen'], default: 'active' },
  },
  { timestamps: true }
);
walletSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
walletSchema.index({ isPlatform: 1 }, { unique: true, partialFilterExpression: { isPlatform: true } });

const ledgerSchema = new Schema(
  {
    walletId: id('Wallet'),
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      required: true,
      enum: ['topup', 'hold', 'hold_release', 'payment', 'earning', 'commission', 'withdrawal', 'withdrawal_reversal', 'adjustment'],
    },
    amount: { type: Number, default: 0 },
    held: { type: Number, default: 0 },
    balanceAfter: Number,
    heldAfter: Number,
    ref: { type: String, required: true, unique: true },
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ledgerSchema.index({ userId: 1, createdAt: -1 });

const topupSchema = new Schema(
  {
    userId: id('User'),
    reference: { type: String, required: true, unique: true },
    amountKobo: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    channel: String,
    paidAt: Date,
  },
  { timestamps: true }
);

const bankSchema = new Schema(
  {
    userId: id('User'),
    bankCode: { type: String, required: true },
    bankName: String,
    accountLast4: { type: String, required: true },
    accountName: { type: String, required: true },
    recipientCode: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
bankSchema.index({ userId: 1, recipientCode: 1 }, { unique: true });

const withdrawalSchema = new Schema(
  {
    userId: id('User'),
    bankAccountId: id('BankAccount'),
    amountKobo: { type: Number, required: true },
    feeKobo: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending_review', 'processing', 'paid', 'failed', 'rejected'],
      default: 'pending_review',
      index: true,
    },
    transferCode: String,
    providerStatus: String,
    failureReason: String,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    paidAt: Date,
  },
  { timestamps: true }
);

export const Wallet = mongoose.model('Wallet', walletSchema);
export const LedgerEntry = mongoose.model('LedgerEntry', ledgerSchema);
export const Topup = mongoose.model('Topup', topupSchema);
export const BankAccount = mongoose.model('BankAccount', bankSchema);
export const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
