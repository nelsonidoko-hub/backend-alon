import test from 'node:test';
import assert from 'node:assert/strict';

// Settlement arithmetic, mirrored from wallet.service settle(): charge + release must equal the hold,
// and earning + commission must equal the charge.
function split(heldKobo, chargeKobo, percent) {
  const charge = Math.min(Math.max(chargeKobo, 0), heldKobo);
  const release = heldKobo - charge;
  const commission = Math.floor((charge * percent) / 100);
  return { charge, release, commission, earning: charge - commission };
}

test('completed ride: 10% commission, nothing released', () => {
  assert.deepEqual(split(50000, 50000, 10), { charge: 50000, release: 0, commission: 5000, earning: 45000 });
});

test('cancelled ride: whole hold is released', () => {
  assert.deepEqual(split(50000, 0, 10), { charge: 0, release: 50000, commission: 0, earning: 0 });
});

test('no-show fee splits the hold and never loses a kobo', () => {
  const r = split(33300, 3330, 10);
  assert.equal(r.charge + r.release, 33300);
  assert.equal(r.commission + r.earning, r.charge);
});

test('charge is capped at the hold', () => {
  assert.equal(split(1000, 5000, 0).charge, 1000);
});
