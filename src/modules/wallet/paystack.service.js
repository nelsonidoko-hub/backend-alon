import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

export class PaystackError extends AppError {
  /** definite = Paystack answered and refused. false = network or server trouble, outcome unknown. */
  constructor(message, definite) {
    super(502, message, 'PAYSTACK_ERROR');
    this.definite = definite;
  }
}

export const paymentsEnabled = () => Boolean(env.PAYSTACK_SECRET_KEY);

export async function paystack(path, { method = 'GET', body } = {}) {
  if (!env.PAYSTACK_SECRET_KEY) throw new AppError(503, 'Payments are not set up yet', 'PAYMENTS_DISABLED');
  let res;
  try {
    res = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new PaystackError('Could not reach Paystack', false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    throw new PaystackError(data.message || 'Paystack request failed', res.status >= 400 && res.status < 500);
  }
  return data;
}
