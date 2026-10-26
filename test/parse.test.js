import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearch, parsePrice } from '../core/parse.js';

const html = readFileSync(new URL('./fixtures/search.html', import.meta.url), 'utf8');
const items = parseSearch(html);

test('parses all articles from the fixture', () => {
  assert.equal(items.length, 27);
  for (const it of items) {
    assert.match(it.adid, /^\d+$/);
    assert.ok(it.title.length > 0);
    assert.ok(it.url.startsWith('https://www.kleinanzeigen.de/s-anzeige/'));
    assert.ok(it.url.includes(it.adid));
  }
});

test('extracts PLZ and city', () => {
  const first = items[0];
  assert.equal(first.plz, '46286');
  assert.equal(first.city, 'Dorsten');
  assert.ok(items.filter((i) => i.plz).length >= 25);
});

test('extracts image, price and date', () => {
  assert.match(items[0].image, /^https:\/\/img\.kleinanzeigen\.de\//);
  const vb = items.find((i) => i.adid === '3497740990');
  assert.equal(vb.price, 100);
  assert.equal(vb.vb, true);
  assert.equal(vb.priceText, '100 € VB');
  assert.equal(items.find((i) => i.adid === '3552799997').date, 'Heute, 10:33');
});

test('parsePrice variants', () => {
  assert.deepEqual(parsePrice('600 € VB'), { price: 600, vb: true });
  assert.deepEqual(parsePrice('1.250 €'), { price: 1250, vb: false });
  assert.deepEqual(parsePrice('Zu verschenken'), { price: 0, vb: false });
  assert.deepEqual(parsePrice(''), { price: null, vb: false });
});
