import { connectDb, disconnectDb } from '../src/config/db.js';
import { User } from '../src/modules/users/user.model.js';
import { normalizePhone } from '../src/utils/phone.js';

const phone = normalizePhone(process.argv[2] || '');
if (!phone) {
  console.error('Usage: npm run create-admin -- 08012345678');
  process.exit(1);
}

await connectDb();
await User.findOneAndUpdate(
  { phone },
  { role: 'admin', phoneVerifiedAt: new Date() },
  { upsert: true, new: true }
);
console.log(`Admin ready: ${phone}`);
await disconnectDb();
