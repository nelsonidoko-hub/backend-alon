import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, buildPath, project, etaSeconds } from '../src/utils/geo.js';

test('haversine: one degree of longitude at the equator is about 111 km', () => {
  const d = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(Math.abs(d - 111195) < 300);
});

test('project: a point beside the path maps to the right distance along it', () => {
  const path = buildPath([
    { lat: 9, lng: 7.0 },
    { lat: 9, lng: 7.1 },
    { lat: 9, lng: 7.2 },
  ]);
  const mid = project(path, { lat: 9.0005, lng: 7.1 });
  assert.ok(Math.abs(mid.distAlong - path.cum[1]) < 5);
  assert.ok(mid.distFrom < 60);
});

test('project: points before and after the path are clamped', () => {
  const path = buildPath([{ lat: 9, lng: 7.0 }, { lat: 9, lng: 7.1 }]);
  assert.equal(Math.round(project(path, { lat: 9, lng: 6.9 }).distAlong), 0);
  assert.ok(Math.abs(project(path, { lat: 9, lng: 7.3 }).distAlong - path.length) < 1);
});

test('etaSeconds uses a sane speed range', () => {
  assert.equal(etaSeconds(7000, undefined), 1000);
  assert.equal(etaSeconds(1400, 100), 100);
  assert.equal(etaSeconds(400, 0.5), 100);
  assert.equal(etaSeconds(-50, 7), 0);
});
