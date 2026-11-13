// Small pure helpers for building WhatsApp messages. WhatsApp has hard length limits.
export const cut = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
export const first = (name) => (name ? String(name).trim().split(/\s+/)[0] : 'there');

/** One page of list rows (max 9 items plus a "More" row, because WhatsApp lists hold 10 rows). */
export function pageRows(items, page, toRow, moreId, size = 9) {
  const start = page * size;
  const rows = items.slice(start, start + size).map(toRow);
  if (start + size < items.length) rows.push({ id: moreId(page + 1), title: 'More…' });
  return rows;
}

/** Template parameters may not contain new lines, tabs or long runs of spaces. */
export const templateText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
