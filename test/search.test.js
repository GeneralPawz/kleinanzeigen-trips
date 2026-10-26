import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTable } from '../server/plz.js';
import { buildSearchUrl, slugify } from '../server/kleinanzeigen/client.js';
import { BlockedError } from '../server/kleinanzeigen/client.js';
import { startSearch, getJob, validateSearch } from '../server/search.js';

test('slugify and URL building', () => {
  assert.equal(slugify('Kühl Schrank'), 'kühl-schrank');
  assert.equal(
    buildSearchUrl({ plz: '34117', radius: 30, query: 'Kühlschrank', locId: '4930' }),
    'https://www.kleinanzeigen.de/s-34117/k%C3%BChlschrank/k0l4930r30',
  );
  assert.equal(
    buildSearchUrl({ plz: '34117', radius: 30, query: 'Fahrrad', minPrice: 50, maxPrice: 300, locId: '4930' }),
    'https://www.kleinanzeigen.de/s-34117/preis:50:300/fahrrad/k0l4930r30',
  );
});

test('validateSearch', () => {
  assert.ok(validateSearch({}));
  assert.equal(
    validateSearch({ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, corridorKm: 10, items: [{ query: 'x' }] }),
    null,
  );
});

const waitDone = async (id) => {
  for (let i = 0; i < 100; i++) {
    const j = getJob(id);
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
};

const body = {
  geometry: { type: 'LineString', coordinates: [[10, 50], [10, 52]] },
  corridorKm: 20,
  items: [{ query: 'Fahrrad' }],
};

test('job filters by corridor, dedupes, sorts by kmAlongRoute', async () => {
  setTable({ plz: { 11111: [50, 10], 22222: [51, 10.05], 33333: [51.5, 12] }, cities: {} });
  const mk = (adid, plz) => ({ adid, title: adid, plz, city: 'X', url: `u/${adid}` });
  const job = startSearch(body, async ({ plz }) => [mk('b', '22222'), mk('a', '11111'), mk('far', '33333')]);
  const j = await waitDone(job);
  assert.equal(j.status, 'done');
  assert.deepEqual(j.results.map((r) => r.adid), ['a', 'b']);
  assert.ok(j.results[1].distanceToRouteKm < 5);
  assert.equal(j.progress.done, j.progress.total);
});

test('stop radius: keeps ads near a stop outside the corridor, tags nearStop, dedupes samples', async () => {
  // route runs along lon 10; the stop at (51, 10.5) is ~35 km off the route
  setTable({ plz: { 11111: [50, 10], 44444: [51, 10.5], 55555: [51, 11.5] }, cities: {} });
  const calls = [];
  const mk = (adid, plz) => ({ adid, title: adid, plz, city: 'X', url: `u/${adid}` });
  const b = {
    ...body,
    corridorKm: 5,
    stops: [
      { lat: 51, lon: 10.5, label: 'Oma', radiusKm: 10 },
      { lat: 51.01, lon: 10.5, label: 'Doppelt', radiusKm: 10 },
      { lat: 50, lon: 10, label: 'aus', radiusKm: 0 },
    ],
  };
  const job = startSearch(b, async (q) => {
    calls.push(`${q.plz}:${q.radius}`);
    return [mk('near', '44444'), mk('far', '55555'), mk('onroute', '11111')];
  });
  const j = await waitDone(job);
  assert.equal(j.status, 'done');
  assert.equal(new Set(calls).size, calls.length, 'no duplicate (plz,radius) searches');
  assert.ok(calls.includes('44444:10'));
  const near = j.results.find((r) => r.adid === 'near');
  assert.equal(near.nearStop, 'Oma');
  assert.ok(near.distanceToStopKm <= 10);
  const onroute = j.results.find((r) => r.adid === 'onroute');
  assert.equal(onroute.nearStop, null);
  assert.equal(onroute.distanceToStopKm, null);
  assert.equal(j.results.find((r) => r.adid === 'far'), undefined);
});

test('validateSearch checks stops', () => {
  assert.equal(validateSearch({ ...body, stops: [{ lat: 1, lon: 2, radiusKm: 10 }] }), null);
  assert.ok(validateSearch({ ...body, stops: [{ lat: 1, lon: 2, radiusKm: 7 }] }));
  assert.ok(validateSearch({ ...body, stops: [{ lon: 2 }] }));
});

test('blocked keeps partial results', async () => {
  setTable({ plz: { 11111: [50, 10], 22222: [51, 10], 33333: [52, 10] }, cities: {} });
  let n = 0;
  const job = startSearch(body, async () => {
    if (++n === 2) throw new BlockedError();
    return [{ adid: 'a', title: 'a', plz: '11111', city: 'X', url: 'u' }];
  });
  const j = await waitDone(job);
  assert.equal(j.status, 'blocked');
  assert.equal(j.results.length, 1);
});
