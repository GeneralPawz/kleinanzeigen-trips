// Downloads the GeoNames DE postal-code dump (CC BY 4.0) and writes data/plz-de.json:
//   { "plz": { "34117": [lat, lon] }, "cities": { "kassel": [lat, lon] } }
import AdmZip from 'adm-zip';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ZIP = 'https://download.geonames.org/export/zip/DE.zip';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'plz-de.json');

const res = await fetch(URL_ZIP);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
const text = zip.readAsText('DE.txt');

const acc = (map, key, lat, lon) => {
  const a = map.get(key) || { lat: 0, lon: 0, n: 0 };
  a.lat += lat;
  a.lon += lon;
  a.n++;
  map.set(key, a);
};
const plz = new Map();
const cities = new Map();
for (const line of text.split('\n')) {
  const f = line.split('\t');
  if (f.length < 11) continue;
  const lat = parseFloat(f[9]);
  const lon = parseFloat(f[10]);
  if (!/^\d{5}$/.test(f[1]) || Number.isNaN(lat) || Number.isNaN(lon)) continue;
  acc(plz, f[1], lat, lon);
  acc(cities, f[2].toLowerCase(), lat, lon);
}
const round = (m) =>
  Object.fromEntries(
    [...m].sort().map(([k, a]) => [k, [+(a.lat / a.n).toFixed(4), +(a.lon / a.n).toFixed(4)]]),
  );
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ plz: round(plz), cities: round(cities) }));
console.log(`PLZ: ${plz.size}, cities: ${cities.size} -> ${out}`);
