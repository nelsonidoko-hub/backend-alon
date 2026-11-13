const SECRET = /code|token|secret|password|key/i;

/** Copies a request body for the audit log, hiding secrets and cutting long values. */
export function redact(value, depth = 0) {
  if (value == null || depth > 3) return value == null ? value : '[…]';
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? '[hidden]' : redact(v, depth + 1);
  return out;
}
