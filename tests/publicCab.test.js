import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicCab } from '../src/modules/sessions/publicCab.js';

const cab = {
  sessionId: 's1',
  seatsFree: 2,
  seatsTotal: 4,
  full: false,
  distanceMeters: 1234,
  etaSeconds: 180,
  location: { lat: 9.07134567, lng: 7.43318912, heading: 88 },
  driver: { name: 'Musa', ratingAvg: 4.8, ratingCount: 10, photoUrl: 'https://x/y.jpg' },
  vehicle: { plate: 'ABC-123-XY', make: 'Toyota', model: 'Corolla', colour: 'White' },
  fare: 40000,
};

test('visitor view keeps seats, fare and ETA', () => {
  const v = toPublicCab(cab);
  assert.equal(v.sessionId, 's1');
  assert.equal(v.seatsFree, 2);
  assert.equal(v.etaSeconds, 180);
  assert.equal(v.fare, 40000);
  assert.equal(v.full, false);
});

test('visitor view hides who is driving and the plate', () => {
  const v = toPublicCab(cab);
  assert.equal(v.driver, null);
  assert.equal(v.vehicle, null);
  assert.ok(!JSON.stringify(v).includes('Musa'));
  assert.ok(!JSON.stringify(v).includes('ABC-123-XY'));
});

test('visitor view rounds the position and drops the heading', () => {
  const v = toPublicCab(cab);
  assert.deepEqual(v.location, { lat: 9.071, lng: 7.433 });
  assert.equal(v.distanceMeters, 1250);
});
