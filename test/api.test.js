import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalApi, memoryStorage } from '../core/index.js';

const html = readFileSync(new URL('./fixtures/search.html', import.meta.url), 'utf8');

// Fixture ads are around Dorsten (46286); a route Dorsten → Münster passes right by.
const plzTable = { plz: { 46286: [51.66, 6.96], 48143: [51.96, 7.63] }, cities: {} };
const geometry = { type: 'LineString', coordinates: [[6.96, 51.66], [7.63, 51.96]] };

function fakeApp() {
  const seen = [];
  const http = {
    async getText(url) {
      seen.push(url);
      return html;
    },
    async getJson(url) {
      seen.push(url);
      if (url.includes('s-ort-empfehlungen')) return { _0: 'x', _4930: '46286 Dorsten' };
      if (url.includes('nominatim')) return [{ display_name: 'Kassel, Hessen', lat: '51.31', lon: '9.48' }];
      if (url.includes('osrm')) {
        return { code: 'Ok', routes: [{ geometry, distance: 48200, duration: 2400 }] };
      }
      throw new Error(`unexpected ${url}`);
    },
  };
  const api = createLocalApi({ http, storage: memoryStorage(), plzTable, delay: [0, 0], sampleKm: 100 });
  return { api, seen };
}

test('local api: route CRUD, merkliste, contacts', async () => {
  const { api } = fakeApp();
  const { handle } = api;
  assert.deepEqual(await handle('GET', '/api/routes'), { status: 200, json: [] });
  assert.equal((await handle('POST', '/api/routes', { corridorKm: 5 })).status, 400);
  const c = await handle('POST', '/api/routes', { name: 'Tour', searchMode: 'radius', corridorKm: 0 });
  assert.equal(c.status, 201);
  const id = c.json.id;
  assert.equal((await handle('GET', `/api/routes/${id}`)).json.searchMode, 'radius');
  assert.equal((await handle('PUT', `/api/routes/${id}`, { name: 'Neu' })).json.name, 'Neu');
  assert.deepEqual((await handle('GET', '/api/routes')).json.map((r) => r.name), ['Neu']);
  assert.deepEqual(await handle('DELETE', `/api/routes/${id}`), { status: 200, json: { ok: true } });
  assert.equal((await handle('GET', `/api/routes/${id}`)).status, 404);

  assert.equal((await handle('PUT', '/api/merkliste/bad%20id', { ad: {} })).status, 400);
  assert.equal((await handle('PUT', '/api/merkliste/42', { ad: { title: 'Rad' }, routeId: null })).json.ad.adid, '42');
  assert.equal((await handle('GET', '/api/merkliste')).json.length, 1);
  assert.equal((await handle('DELETE', '/api/merkliste/42')).status, 200);

  assert.equal((await handle('PUT', '/api/contacts/42', { status: 'antwort' })).json.status, 'antwort');
  const n = await handle('POST', '/api/contacts/42/notes', { text: 'hallo' });
  assert.equal(n.status, 201);
  assert.equal((await handle('GET', '/api/contacts')).json['42'].notes.length, 1);
  assert.equal((await handle('DELETE', `/api/contacts/42/notes/${n.json.id}`)).status, 200);

  assert.equal((await handle('GET', '/api/mail/status')).json.configured, false);
  assert.deepEqual((await handle('GET', '/api/mail/notifications')).json, { byAd: {}, unmatched: [] });
  assert.equal((await handle('GET', '/api/nope')).status, 404);
});

test('local api: geocode and route', async () => {
  const { api } = fakeApp();
  assert.equal((await api.handle('GET', '/api/geocode')).status, 400);
  const g = await api.handle('GET', '/api/geocode?q=Kassel');
  assert.deepEqual(g.json, [{ label: 'Kassel, Hessen', lat: 51.31, lon: 9.48 }]);
  assert.equal((await api.handle('POST', '/api/route', { waypoints: [{ lat: 1, lon: 1 }] })).status, 400);
  const r = await api.handle('POST', '/api/route', { waypoints: [{ lat: 51.66, lon: 6.96 }, { lat: 51.96, lon: 7.63 }] });
  assert.equal(r.json.distanceKm, 48.2);
  assert.equal(r.json.durationMin, 40);
});

test('local api: search job end to end with fixture HTML', async () => {
  const { api, seen } = fakeApp();
  assert.equal((await api.handle('POST', '/api/search', { geometry })).status, 400);
  const s = await api.handle('POST', '/api/search', { geometry, corridorKm: 20, items: [{ query: 'Fahrrad' }] });
  assert.equal(s.status, 200);
  let job;
  for (let i = 0; i < 200; i++) {
    job = (await api.handle('GET', `/api/search/${s.json.jobId}`)).json;
    if (job.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.status, 'done');
  assert.ok(job.results.length > 0);
  assert.ok(job.results.every((r) => r.distanceToRouteKm <= 20 && r.nearStop === null));
  assert.ok(seen.some((u) => u.includes('/s-46286/fahrrad/k0l4930r30')));
  assert.equal((await api.handle('GET', '/api/search/unknown')).status, 404);
});

test('local api: radius-only search via stops', async () => {
  const { api } = fakeApp();
  const stops = [{ lat: 51.66, lon: 6.96, label: 'Dorsten', radiusKm: 10 }];
  const s = await api.handle('POST', '/api/search', { geometry, corridorKm: 0, items: [{ query: 'x' }], stops });
  assert.equal(s.status, 200);
  let job;
  for (let i = 0; i < 200; i++) {
    job = (await api.handle('GET', `/api/search/${s.json.jobId}`)).json;
    if (job.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.status, 'done');
  assert.ok(job.results.length > 0 && job.results.every((r) => r.nearStop === 'Dorsten'));
});
