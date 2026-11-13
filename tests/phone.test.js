import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../src/utils/phone.js';

test('normalizes common Nigerian formats', () => {
  assert.equal(normalizePhone('08012345678'), '+2348012345678');
  assert.equal(normalizePhone('2348012345678'), '+2348012345678');
  assert.equal(normalizePhone('+234 801 234 5678'), '+2348012345678');
});

test('rejects invalid numbers', () => {
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('+2341234567890'), null);
  assert.equal(normalizePhone('0601234567'), null);
});
