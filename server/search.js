import { randomUUID } from 'node:crypto';
import { buildSamples, buildStopSamples, dedupeSamples, distanceToRoute, cumulativeKm } from './corridor.js';
import { haversineKm } from './geo.js';
import { STOP_RADII } from './store.js';
import { lookup } from './plz.js';
import { searchPlz, BlockedError } from './kleinanzeigen/client.js';

/** @type {Map<string, any>} */
const jobs = new Map();
const JOB_TTL = 60 * 60 * 1000;

/** Spacing between search points; SAMPLE_KM overrides it to keep request volume low while testing. */
const sampleKm = () => Number(process.env.SAMPLE_KM) || 25;

export function validateSearch(body) {
  const coords = body?.geometry?.coordinates;
  if (body?.geometry?.type !== 'LineString' || !Array.isArray(coords) || coords.length < 2) {
    return 'geometry muss ein GeoJSON-LineString sein';
  }
  if (!Array.isArray(body.items) || body.items.length === 0) return 'items darf nicht leer sein';
  if (body.items.some((i) => !i || typeof i.query !== 'string' || !i.query.trim())) return 'jedes Item braucht eine query';
  if (!(Number(body.corridorKm) > 0)) return 'corridorKm muss > 0 sein';
  if (body.stops != null) {
    if (!Array.isArray(body.stops) || body.stops.length > 10) return 'stops muss ein Array mit höchstens 10 Einträgen sein';
    for (const s of body.stops) {
      if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return 'jeder Stopp braucht lat/lon';
      if (!STOP_RADII.includes(s.radiusKm ?? 0)) return `radiusKm muss einer von ${STOP_RADII.join(', ')} sein`;
    }
  }
  return null;
}

/** Nearest stop whose radius contains the point. */
export function nearestStop(lat, lon, stops) {
  let best = null;
  for (const s of stops) {
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d <= s.radiusKm && (!best || d < best.distKm)) best = { label: s.label, distKm: d };
  }
  return best;
}

export function startSearch(body, search = searchPlz) {
  const coords = body.geometry.coordinates;
  const corridorKm = Number(body.corridorKm);
  const items = body.items.map((i) => ({
    query: i.query.trim(),
    minPrice: i.minPrice === '' ? null : (i.minPrice ?? null),
    maxPrice: i.maxPrice === '' ? null : (i.maxPrice ?? null),
  }));
  const stops = (body.stops || [])
    .map((s, i) => ({ lat: s.lat, lon: s.lon, label: String(s.label || `Stopp ${i + 1}`), radiusKm: s.radiusKm ?? 0 }))
    .filter((s) => s.radiusKm > 0);
  const samples = dedupeSamples([...buildSamples(coords, { stepKm: sampleKm(), radius: 30 }), ...buildStopSamples(stops)]);
  const job = {
    id: randomUUID().slice(0, 12),
    status: 'running',
    progress: { done: 0, total: samples.length * items.length },
    error: null,
    results: [],
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  for (const [id, j] of jobs) if (Date.now() - j.createdAt > JOB_TTL) jobs.delete(id);

  const cum = cumulativeKm(coords);
  const seen = new Set();
  (async () => {
    try {
      for (const sample of samples) {
        for (const item of items) {
          const found = await search({ plz: sample.plz, radius: sample.radius, ...item });
          for (const r of found) {
            if (seen.has(r.adid)) continue;
            const pos = lookup(r.plz, r.city);
            if (!pos) continue;
            const { distKm, kmAlong } = distanceToRoute(pos[0], pos[1], coords, cum);
            const stop = nearestStop(pos[0], pos[1], stops);
            if (distKm > corridorKm && !stop) continue;
            seen.add(r.adid);
            job.results.push({
              ...r,
              query: item.query,
              lat: pos[0],
              lon: pos[1],
              distanceToRouteKm: Math.round(distKm * 10) / 10,
              kmAlongRoute: Math.round(kmAlong * 10) / 10,
              nearStop: stop ? stop.label : null,
              distanceToStopKm: stop ? Math.round(stop.distKm * 10) / 10 : null,
            });
            job.results.sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
          }
          job.progress.done++;
        }
      }
      job.status = 'done';
    } catch (e) {
      if (e instanceof BlockedError) {
        job.status = 'blocked';
        job.error = e.message;
      } else {
        job.status = 'error';
        job.error = e.message;
      }
    }
  })();
  return job.id;
}

export function getJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  return { status: j.status, progress: j.progress, error: j.error, results: j.results };
}
