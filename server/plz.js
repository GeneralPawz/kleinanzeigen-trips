import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'plz-de.json');

/** @type {{plz: Record<string,[number,number]>, cities: Record<string,[number,number]>}} */
let table = { plz: {}, cities: {} };
let entries = [];
if (existsSync(file)) {
  table = JSON.parse(readFileSync(file, 'utf8'));
  entries = Object.entries(table.plz);
} else {
  console.warn('data/plz-de.json missing — run `npm run build:plz`');
}

/** Replace the table (used by tests). */
export function setTable(t) {
  table = t;
  entries = Object.entries(t.plz);
}

/** @returns {[number,number]|null} [lat, lon] for a PLZ, falling back to a city name. */
export function lookup(plz, city) {
  if (plz && table.plz[plz]) return table.plz[plz];
  if (city) {
    const c = city.toLowerCase();
    return table.cities[c] || table.cities[c.split(/[\s,(-]/)[0]] || null;
  }
  return null;
}

/** Nearest PLZ centroid by simple scan (equirectangular metric). */
export function nearestPlz(lat, lon) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestD = Infinity;
  for (const [plz, [la, lo]] of entries) {
    const dy = la - lat;
    const dx = (lo - lon) * k;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = { plz, lat: la, lon: lo };
    }
  }
  return best;
}
