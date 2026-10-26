import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, MAX_RESULTS } from '../core/store.js';
import { fileStorage } from '../server/adapters.js';

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'troedel-'));
  const file = join(dir, 'sub', 'store.json');
  return { dir, file, store: createStore(fileStorage(file)) };
};
const status = async (p) => {
  try {
    await p;
  } catch (e) {
    return e.status;
  }
  return null;
};

test('routes: create, list, get, update, delete, persistence', async () => {
  const { file, store } = fresh();
  assert.equal(existsSync(file), false, 'file created on first use');
  const r = await store.createRoute({ name: 'Tour', waypoints: [{ label: 'A', lat: 1, lon: 2, radiusKm: 10 }], corridorKm: 15 });
  assert.ok(existsSync(file));
  assert.equal(r.waypoints[0].radiusKm, 10);
  assert.equal(r.results.length, 0);
  assert.deepEqual((await store.listRoutes()).map((x) => x.name), ['Tour']);
  const u = await store.updateRoute(r.id, { name: 'Neu', searchedAt: '2026-01-01T00:00:00Z' });
  assert.equal(u.name, 'Neu');
  assert.equal(u.corridorKm, 15, 'untouched fields stay');
  assert.equal((await createStore(fileStorage(file)).getRoute(r.id)).name, 'Neu', 'reloaded from disk');
  await store.deleteRoute(r.id);
  assert.equal(await status(store.getRoute(r.id)), 404);
  assert.equal(await status(store.deleteRoute(r.id)), 404);
});

test('routes: validation and result cap', async () => {
  const { store, dir } = fresh();
  assert.equal(await status(store.createRoute({})), 400);
  assert.equal(await status(store.createRoute({ name: 'x', corridorKm: -1 })), 400);
  assert.equal(await status(store.createRoute({ name: 'x', waypoints: [{ lat: 1, lon: 2, radiusKm: 7 }] })), 400);
  assert.equal(await status(store.createRoute({ name: 'x', geometry: { type: 'Point' } })), 400);
  assert.equal(await status(store.createRoute({ name: 'x', items: [{ query: '' }] })), 400);
  assert.equal(await status(store.createRoute({ name: 'x', searchMode: 'quatsch' })), 400);
  const r = await store.createRoute({ name: 'x', results: Array.from({ length: MAX_RESULTS + 20 }, (_, i) => ({ adid: String(i) })) });
  assert.equal(r.results.length, MAX_RESULTS);
  assert.equal(await status(store.updateRoute('nope', { name: 'y' })), 404);
  assert.deepEqual(readdirSync(join(dir, 'sub')), ['store.json'], 'no temp files left behind');
});

test('routes: searchMode and corridorKm 0 persist', async () => {
  const { file, store } = fresh();
  const r = await store.createRoute({ name: 'x', searchMode: 'radius', corridorKm: 0 });
  assert.equal(r.searchMode, 'radius');
  assert.equal(r.corridorKm, 0);
  assert.equal((await store.createRoute({ name: 'y' })).searchMode, undefined, 'optional');
  const again = await createStore(fileStorage(file)).getRoute(r.id);
  assert.equal(again.searchMode, 'radius');
  assert.equal((await store.updateRoute(r.id, { searchMode: 'corridor' })).searchMode, 'corridor');
});

test('merkliste', async () => {
  const { store } = fresh();
  assert.equal(await status(store.putMerkliste('1', {})), 400);
  const e = await store.putMerkliste('1', { ad: { title: 'Rad' }, routeId: 'r1' });
  assert.equal(e.ad.adid, '1');
  const again = await store.putMerkliste('1', { ad: { title: 'Rad2' }, routeId: null });
  assert.equal(again.savedAt, e.savedAt);
  assert.equal((await store.listMerkliste()).length, 1);
  await store.deleteMerkliste('1');
  assert.equal(await status(store.deleteMerkliste('1')), 404);
});

test('contacts: status and notes', async () => {
  const { store } = fresh();
  assert.equal(await status(store.putContactStatus('1', { status: 'quatsch' })), 400);
  assert.equal((await store.putContactStatus('1', { status: 'angeschrieben' })).status, 'angeschrieben');
  const n = await store.addNote('1', { text: ' Antwort morgen ' });
  assert.equal(n.text, 'Antwort morgen');
  assert.equal(await status(store.addNote('1', { text: '  ' })), 400);
  assert.equal((await store.listContacts())['1'].notes.length, 1);
  await store.deleteNote('1', n.id);
  assert.equal(await status(store.deleteNote('1', n.id)), 404);
  assert.equal(await status(store.deleteNote('zz', 'x')), 404);
});
