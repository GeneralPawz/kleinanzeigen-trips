import { haversineKm, pointToSegment } from './geo.js';
import { nearestPlz } from './plz.js';

export const RADIUS_STEPS = [5, 10, 20, 30, 50, 100];

/** @param {[number,number][]} coords GeoJSON [lon,lat] */
export function cumulativeKm(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return cum;
}

/**
 * Points every ~stepKm along the line, including start and end.
 * @returns {{lat:number,lon:number,km:number}[]}
 */
export function samplePoints(coords, stepKm = 25) {
  const cum = cumulativeKm(coords);
  const total = cum[cum.length - 1];
  const out = [{ lat: coords[0][1], lon: coords[0][0], km: 0 }];
  let seg = 0;
  for (let target = stepKm; target < total; target += stepKm) {
    while (seg < coords.length - 2 && cum[seg + 1] < target) seg++;
    const len = cum[seg + 1] - cum[seg] || 1;
    const t = (target - cum[seg]) / len;
    const [lo1, la1] = coords[seg];
    const [lo2, la2] = coords[seg + 1];
    out.push({ lat: la1 + (la2 - la1) * t, lon: lo1 + (lo2 - lo1) * t, km: target });
  }
  const last = coords[coords.length - 1];
  if (total > 0) out.push({ lat: last[1], lon: last[0], km: total });
  return out;
}

/**
 * Distance from a point to the polyline and position along it.
 * @param {[number,number][]} coords
 * @param {number[]} [cum] precomputed cumulativeKm(coords)
 */
export function distanceToRoute(lat, lon, coords, cum = cumulativeKm(coords)) {
  let best = { distKm: Infinity, kmAlong: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const { km, t } = pointToSegment(lat, lon, coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
    if (km < best.distKm) best = { distKm: km, kmAlong: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}

/**
 * Search samples along the route: one per distinct nearest PLZ.
 * @returns {{plz:string,lat:number,lon:number,radius:number,km:number}[]}
 */
export function buildSamples(coords, { stepKm = 25, radius = 30 } = {}) {
  if (!RADIUS_STEPS.includes(radius)) throw new Error(`radius must be one of ${RADIUS_STEPS}`);
  const seen = new Set();
  const out = [];
  for (const p of samplePoints(coords, stepKm)) {
    const n = nearestPlz(p.lat, p.lon);
    if (!n || seen.has(n.plz)) continue;
    seen.add(n.plz);
    out.push({ plz: n.plz, lat: n.lat, lon: n.lon, radius, km: p.km });
  }
  return out;
}
