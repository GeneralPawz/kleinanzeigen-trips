import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geocode } from './geocode.js';
import { getRoute } from './route.js';
import { userApi } from './user-api.js';
import { startSearch, getJob, validateSearch } from './search.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }));
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

app.get(
  '/api/geocode',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) throw bad('Parameter q fehlt');
    res.json(await geocode(q));
  }),
);

app.post(
  '/api/route',
  wrap(async (req, res) => {
    const w = req.body?.waypoints;
    const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
    if (!Array.isArray(w) || w.length < 2 || w.length > 10 || !w.every(ok)) {
      throw bad('waypoints: 2–10 Punkte mit lat/lon erforderlich');
    }
    res.json(await getRoute(w));
  }),
);

app.post(
  '/api/search',
  wrap(async (req, res) => {
    const err = validateSearch(req.body);
    if (err) throw bad(err);
    res.json({ jobId: startSearch(req.body) });
  }),
);

app.get(
  '/api/search/:jobId',
  wrap(async (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
    res.json(job);
  }),
);

app.use('/api', userApi);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unbekannter Endpunkt' }));
app.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Anfrage zu groß (max. 1 MB)' : 'Ungültiges JSON' });
});
app.use(express.static(join(root, 'public')));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Trödeltour läuft auf http://localhost:${port}`));
