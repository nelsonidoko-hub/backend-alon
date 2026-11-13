import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { cut, pageRows, templateText, first, naira } from '../src/modules/whatsapp/whatsapp.format.js';
import { validSignature } from '../src/modules/whatsapp/signature.js';

test('cut respects WhatsApp length limits', () => {
  assert.equal(cut('Berger Roundabout Junction', 24).length, 24);
  assert.equal(cut('short', 24), 'short');
});

test('pageRows keeps lists at 10 rows and adds a More row', () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ n: i }));
  const toRow = (x) => ({ id: `s${x.n}`, title: `Stop ${x.n}` });
  const p0 = pageRows(items, 0, toRow, (p) => `more:${p}`);
  assert.equal(p0.length, 10);
  assert.equal(p0.at(-1).id, 'more:1');
  const p2 = pageRows(items, 2, toRow, (p) => `more:${p}`);
  assert.equal(p2.length, 5);
  assert.ok(p2.every((r) => !r.id.startsWith('more')));
});

test('templateText removes new lines and extra spaces', () => {
  assert.equal(templateText('Hello\n\nthere      friend'), 'Hello there friend');
});

test('first name and naira helpers', () => {
  assert.equal(first('Ada Obi'), 'Ada');
  assert.equal(first(''), 'there');
  assert.equal(naira(1500), '₦1,500');
});

test('webhook signature check', () => {
  const body = Buffer.from('{"entry":[]}');
  const good = `sha256=${crypto.createHmac('sha256', 'secret').update(body).digest('hex')}`;
  assert.equal(validSignature(body, good, 'secret'), true);
  assert.equal(validSignature(body, good, 'other'), false);
  assert.equal(validSignature(body, 'sha256=abc', 'secret'), false);
  assert.equal(validSignature(null, good, 'secret'), false);
});
