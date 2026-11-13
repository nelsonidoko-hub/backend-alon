import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/modules/audit/audit.redact.js';

test('redact hides secrets and shortens long text', () => {
  const out = redact({ reason: 'ok', code: '123456', nested: { apiToken: 'x', note: 'a'.repeat(300) } });
  assert.equal(out.reason, 'ok');
  assert.equal(out.code, '[hidden]');
  assert.equal(out.nested.apiToken, '[hidden]');
  assert.equal(out.nested.note.length, 201);
});

test('redact limits arrays and depth', () => {
  assert.equal(redact(Array.from({ length: 50 }, (_, i) => i)).length, 20);
  assert.equal(redact({ a: { b: { c: { d: { e: 1 } } } } }).a.b.c.d, '[…]');
});
