// Builds the Capacitor web bundle: public/ + vendored Leaflet + markercluster + core/ + app/ adapter → www/
import { build } from 'esbuild';
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const www = join(root, 'www');
const p = (...a) => join(root, ...a);

await rm(www, { recursive: true, force: true });
await mkdir(join(www, 'vendor', 'leaflet'), { recursive: true });
await mkdir(join(www, 'vendor', 'markercluster'), { recursive: true });

await cp(p('public'), www, { recursive: true });
await cp(p('data', 'plz-de.json'), join(www, 'plz-de.json'));
await cp(p('node_modules', 'leaflet', 'dist', 'leaflet.js'), join(www, 'vendor', 'leaflet', 'leaflet.js'));
await cp(p('node_modules', 'leaflet', 'dist', 'leaflet.css'), join(www, 'vendor', 'leaflet', 'leaflet.css'));
await cp(p('node_modules', 'leaflet', 'dist', 'images'), join(www, 'vendor', 'leaflet', 'images'), { recursive: true });
for (const f of ['leaflet.markercluster.js', 'MarkerCluster.css']) await cp(p('node_modules', 'leaflet.markercluster', 'dist', f), join(www, 'vendor', 'markercluster', f));

await build({
  entryPoints: [p('app', 'native.js')],
  outfile: join(www, 'native.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome100',
  minify: true,
  logLevel: 'info',
});

// index.html: local Leaflet instead of unpkg (no SRI/CORS needed), native bundle before the app module
let html = await readFile(join(www, 'index.html'), 'utf8');
const swap = (re, to) => {
  if (!re.test(html)) throw new Error(`index.html: ${re} nicht gefunden`);
  html = html.replace(re, to);
};
swap(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet[^>]*>/, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">');
swap(/<script src="https:\/\/unpkg\.com\/leaflet[^>]*><\/script>/, '<script src="vendor/leaflet/leaflet.js"></script>\n  <script src="native.js"></script>');
await writeFile(join(www, 'index.html'), html);
console.log('www/ built');
