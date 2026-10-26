import { buildSamples, buildStopSamples, dedupeSamples, distanceToRoute, cumulativeKm } from './corridor.js';
import { haversineKm } from './geo.js';
import { STOP_RADII, newId } from './store.js';
import { BlockedError } from './kleinanzeigen.js';

const JOB_TTL = 60 * 60 * 1000;

export function validateSearch(body) {
  const coords = body?.geometry?.coordinates;
  if (body?.geometry?.type !== 'LineString' || !Array.isArray(coords) || coords.length < 2) {
    return 'geometry muss ein GeoJSON-LineString sein';
  }
  if (!Array.isArray(body.items) || body.items.length === 0) return 'items darf nicht leer sein';
  if (body.items.some((i) => !i || typeof i.query !== 'string' || !i.query.trim())) return 'jedes Item braucht eine query';
  const corridorKm = Number(body.corridorKm);
  const radiusOnly = corridorKm === 0 && Array.isArray(body.stops) && body.stops.some((s) => s?.radiusKm > 0);
  if (!(corridorKm > 0) && !radiusOnly) return 'corridorKm muss > 0 sein (0 nur mit mindestens einem Stopp-Radius)';
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

/**
 * Search job manager.
 * @param {{ search: (q:{plz:string,radius:number,query:string,minPrice:any,maxPrice:any}) => Promise<any[]>,
 *   plz: ReturnType<typeof import('./plz.js').createPlz>, sampleKm?: number }} opts
 */
export function createSearchManager({ search, plz, sampleKm = 25 }) {
  /** @type {Map<string, any>} */
  const jobs = new Map();

  function startSearch(body) {
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
    // corridorKm 0 = radius-only: no corridor samples, only ads within a stop radius count
    const corridorSamples = corridorKm > 0 ? buildSamples(coords, plz, { stepKm: sampleKm, radius: 30 }) : [];
    const samples = dedupeSamples([...corridorSamples, ...buildStopSamples(stops, plz)]);
    const job = {
      id: newId(),
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
              const pos = plz.lookup(r.plz, r.city);
              if (!pos) continue;
              const { distKm, kmAlong } = distanceToRoute(pos[0], pos[1], coords, cum);
              const stop = nearestStop(pos[0], pos[1], stops);
              if ((corridorKm > 0 ? distKm > corridorKm : true) && !stop) continue;
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
        job.status = e instanceof BlockedError ? 'blocked' : 'error';
        job.error = e.message;
      }
    })();
    return job.id;
  }

  function getJob(id) {
    const j = jobs.get(id);
    if (!j) return null;
    return { status: j.status, progress: j.progress, error: j.error, results: j.results };
  }

  return { startSearch, getJob };
}
