import test from 'node:test';
import assert from 'node:assert/strict';
import { dropFare, tierFare } from '../src/modules/sessions/pricing.js';

test('drop = every seat plus 20%, rounded up to N50', () => {
  assert.equal(dropFare(500, 4, 4, 20), 2400); // 4 x 500 x 1.2
  assert.equal(dropFare(350, 4, 4, 20), 1700); // 1680 -> 1700
  assert.equal(dropFare(500, 4, 4, 0), 2000);
});
test('drop always costs more than one seat and more than the same seats shared', () => {
  for (const [base, total, cap] of [[500, 4, 4], [500, 3, 4], [300, 18, 18], [300, 12, 18]]) {
    assert.ok(dropFare(base, total, cap, 20) > tierFare(base, total, cap) * total - 1);
    assert.ok(dropFare(base, total, cap, 20) > tierFare(base, total, cap));
  }
});
test('no fare known means no drop price', () => {
  assert.equal(dropFare(null, 4, 4), null);
});
