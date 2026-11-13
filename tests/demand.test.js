import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterestStore } from '../src/modules/demand/interest-store.js';

test('counts distinct riders per stop and forgets them after the window', () => {
  let t = 0;
  const store = createInterestStore({ windowMs: 1000, now: () => t });
  store.record('u1', 'r1', 's1');
  store.record('u2', 'r1', 's1');
  store.record('u1', 'r1', 's1');
  store.record('u3', 'r1', 's2');
  assert.deepEqual([...store.activeByStop('r1').get('s1')].sort(), ['u1', 'u2']);
  t = 1500;
  assert.equal(store.activeByStop('r1').size, 0);
});

test('a rider who looks again stays counted', () => {
  let t = 0;
  const store = createInterestStore({ windowMs: 1000, now: () => t });
  store.record('u1', 'r1', 's1');
  t = 800;
  store.record('u1', 'r1', 's1');
  t = 1500;
  assert.equal(store.activeByStop('r1').get('s1').length, 1);
});

test('routes are kept apart', () => {
  const store = createInterestStore();
  store.record('u1', 'r1', 's1');
  assert.equal(store.activeByStop('r2').size, 0);
});
