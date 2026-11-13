export function normalizePhone(input) {
  const s = String(input).replace(/[\s\-()]/g, '');
  let n = null;
  if (/^\+234\d{10}$/.test(s)) n = s;
  else if (/^234\d{10}$/.test(s)) n = `+${s}`;
  else if (/^0\d{10}$/.test(s)) n = `+234${s.slice(1)}`;
  if (!n || !/^\+234[789]\d{9}$/.test(n)) return null;
  return n;
}
