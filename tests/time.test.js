import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfDayLagos } from '../src/utils/time.js';

test('start of day in Lagos is 23:00 UTC the day before', () => {
  const d = startOfDayLagos(new Date('2026-11-07T10:00:00Z'));
  assert.equal(d.toISOString(), '2026-11-06T23:00:00.000Z');
});
