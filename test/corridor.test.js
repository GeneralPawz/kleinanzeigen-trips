import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTable } from '../server/plz.js';
import { haversineKm } from '../server/geo.js';
import { samplePoints, distanceToRoute, buildSamples, cumulativeKm } from '../server/corridor.js';

// Straight line along lon=10 from lat 50 to 52 (~222 km)
const line = [
  [10, 50],
  [10, 51],
  [10, 52],
];

test('haversine ~111 km per degree latitude', () => {
  assert.ok(Math.abs(haversineKm(50, 10, 51, 10) - 111.2) < 0.5);
});

test('samplePoints includes start/end and spacing ~25 km', () => {
  const pts = samplePoints(line, 25);
  const total = cumulativeKm(line).at(-1);
  assert.deepEqual([pts[0].lat, pts[0].lon], [50, 10]);
  assert.ok(Math.abs(pts.at(-1).lat - 52) < 1e-9);
  assert.equal(pts.length, Math.floor(total / 25) + 2);
  assert.ok(Math.abs(haversineKm(pts[1].lat, pts[1].lon, pts[2].lat, pts[2].lon) - 25) < 0.2);
});

test('distanceToRoute and kmAlong', () => {
  // 0.1° lon east of the line at lat 51 → ~7 km
  const r = distanceToRoute(51, 10.1, line);
  assert.ok(Math.abs(r.distKm - 7.0) < 0.3, String(r.distKm));
  assert.ok(Math.abs(r.kmAlong - 111.2) < 1, String(r.kmAlong));
  // beyond the end clamps to the end
  const e = distanceToRoute(53, 10, line);
  assert.ok(Math.abs(e.distKm - 111.2) < 0.5);
  assert.ok(Math.abs(e.kmAlong - cumulativeKm(line).at(-1)) < 0.01);
});

test('buildSamples dedupes by PLZ and uses radius 30', () => {
  setTable({
    plz: { 11111: [50, 10], 22222: [51, 10], 33333: [52, 10] },
    cities: {},
  });
  const s = buildSamples(line, { stepKm: 25 });
  assert.deepEqual(
    s.map((x) => x.plz),
    ['11111', '22222', '33333'],
  );
  assert.ok(s.every((x) => x.radius === 30));
  assert.throws(() => buildSamples(line, { radius: 15 }));
});
