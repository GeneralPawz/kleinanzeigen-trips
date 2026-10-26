import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { createLocalApi } from '../core/index.js';
import { mailApi } from './mail-api.js';
import { startMailPolling } from './mail.js';
import { getStore } from './store.js';
import { nodeHttp, loadPlzTable, loadLocIds, saveLocIds, root } from './adapters.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Everything except mail is the platform-independent core API behind a thin express wrapper.
const api = createLocalApi({
  http: nodeHttp,
  store: getStore(),
  plzTable: loadPlzTable(),
  contactEmail: process.env.CONTACT_EMAIL,
  orsKey: process.env.ORS_API_KEY,
  sampleKm: Number(process.env.SAMPLE_KM) || undefined,
  locIds: loadLocIds(),
  onLocIds: saveLocIds,
});

app.use('/api', mailApi);
app.use('/api', async (req, res) => {
  const { status, json } = await api.handle(req.method, req.originalUrl, req.body);
  res.status(status).json(json);
});
app.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Anfrage zu groß (max. 1 MB)' : 'Ungültiges JSON' });
});
app.use('/vendor/markercluster', express.static(join(root, 'node_modules', 'leaflet.markercluster', 'dist')));
app.use(express.static(join(root, 'public')));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Trödeltour läuft auf http://localhost:${port}`);
  startMailPolling();
});
