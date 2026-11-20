import test from 'node:test';
import assert from 'node:assert/strict';
import { trialInfo, commissionFor } from '../src/modules/drivers/trial.js';

const DAY = 86400000, opts = { trialDays: 60, commissionPercent: 10 };
const d = { approvedAt: new Date('2026-11-01T00:00:00Z') };
const at = (days) => new Date(d.approvedAt.getTime() + days * DAY);

test('free during the 60 days, 10% after', () => {
  assert.equal(commissionFor(d, { ...opts, when: at(0) }), 0);
  assert.equal(commissionFor(d, { ...opts, when: at(59.9) }), 0);
  assert.equal(commissionFor(d, { ...opts, when: at(60) }), 10);
  assert.equal(commissionFor(d, { ...opts, when: at(200) }), 10);
});
test('days left counts down and never goes negative', () => {
  assert.equal(trialInfo(d, { ...opts, now: at(0).getTime() }).daysLeft, 60);
  assert.equal(trialInfo(d, { ...opts, now: at(59.5).getTime() }).daysLeft, 1);
  assert.equal(trialInfo(d, { ...opts, now: at(90).getTime() }).daysLeft, 0);
});
test('older drivers use the day they applied; trial off means normal commission', () => {
  assert.equal(commissionFor({ createdAt: at(0) }, { ...opts, when: at(10) }), 0);
  assert.equal(commissionFor(d, { trialDays: 0, commissionPercent: 10, when: at(1) }), 10);
  assert.equal(commissionFor(null, { ...opts }), 10);
});
