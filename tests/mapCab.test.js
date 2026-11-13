import test from 'node:test';
import assert from 'node:assert/strict';
import { toMapCab } from '../src/modules/sessions/mapCab.js';

test('map cab hides driver, plate and exact position', () => {
  const v = toMapCab(
    { _id: 's1', routeId: { _id: 'r1' }, seatsFree: 0, seatsTotal: 4, driverId: 'd', vehicleId: 'v' },
    { lat: 9.07134567, lng: 7.43318912, heading: 90 },
    'Nyanya to Berger'
  );
  assert.equal(v.routeId, 'r1');
  assert.equal(v.full, true);
  assert.deepEqual(v.location, { lat: 9.071, lng: 7.433 });
  assert.equal(v.driverId, undefined);
  assert.equal(v.vehicleId, undefined);
});