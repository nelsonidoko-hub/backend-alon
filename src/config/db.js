import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Phone is optional now (people can sign up with only an email), so the old index that made every phone unique AND present
 * (phone_1) must go: it treats "no phone" as one shared value and rejects the second email-only account.
 * The partial index in user.model.js (unique only when a phone exists) replaces it. Safe to run any number of times.
 */
export async function ensurePhoneIndex() {
  const { User } = await import('../modules/users/user.model.js');
  const idx = await User.collection.indexes();
  if (idx.some((i) => i.name === 'phone_1')) {
    await User.collection.dropIndex('phone_1');
    logger.warn('Dropped the old phone_1 index on users');
  }
  await User.createIndexes();
}

export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI);
  logger.info('MongoDB connected');
  try {
    await ensurePhoneIndex();
  } catch (err) {
    logger.error({ err }, 'Could not update the phone index');
  }
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
