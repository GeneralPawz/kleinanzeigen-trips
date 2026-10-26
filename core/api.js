import { createPlz } from './plz.js';
import { createGeocoder } from './geocode.js';
import { createRouter } from './route.js';
import { createKleinanzeigenClient } from './kleinanzeigen.js';
import { createSearchManager, validateSearch } from './search.js';
import { createStore, fail } from './store.js';

const ADID = /^[\w-]{1,40}$/;
class Created {
  constructor(json) {
    this.json = json;
  }
}
const NO_MAIL_STATUS = { configured: false, provider: null, user: null, lastCheck: null, error: null };

/**
 * The HTTP API contract (docs/API.md) as a function, for running without the Node server.
 * Mail endpoints answer "not configured" (mail is Node-only).
 * @param {{ http: {getText:Function,getJson:Function,postJson?:Function},
 *   storage: {load:()=>Promise<any>, save:(o:any)=>Promise<void>},
 *   plzTable: {plz:Record<string,[number,number]>, cities:Record<string,[number,number]>},
 *   store?: ReturnType<typeof createStore> (reuse an existing store instead of building one from storage),
 *   contactEmail?: string, orsKey?: string, sampleKm?: number, delay?: [number,number],
 *   locIds?: Record<string,string|null>, onLocIds?: (ids:object)=>void }} opts
 */
export function createLocalApi({ http, storage, store: sharedStore, plzTable, contactEmail, orsKey, sampleKm, delay, locIds, onLocIds }) {
  const plz = createPlz(plzTable);
  const store = sharedStore ?? createStore(storage);
  const geocode = createGeocoder({ http, contactEmail });
  const getRoute = createRouter({ http, orsKey, contactEmail });
  const client = createKleinanzeigenClient({ http, locIds, onLocIds, delay });
  const searches = createSearchManager({ search: client.searchPlz, plz, sampleKm });
  const bad = (m) => fail(400, m);
  const checkAdid = (id) => {
    if (!ADID.test(id)) throw bad('ungültige adid');
  };
  const ok = { ok: true };
  const created = (json) => new Created(json);

  /** [method, regexp over the path without /api, handler(params, body, query) → json | created(json)] */
  const routes = [
    ['GET', /^\/geocode$/, async (_p, _b, query) => {
      const q = String(query.get('q') || '').trim();
      if (!q) throw bad('Parameter q fehlt');
      return geocode(q);
    }],
    ['POST', /^\/route$/, async (_p, body) => {
      const w = body?.waypoints;
      const good = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
      if (!Array.isArray(w) || w.length < 2 || w.length > 10 || !w.every(good)) {
        throw bad('waypoints: 2–10 Punkte mit lat/lon erforderlich');
      }
      return getRoute(w);
    }],
    ['POST', /^\/search$/, async (_p, body) => {
      const err = validateSearch(body);
      if (err) throw bad(err);
      return { jobId: searches.startSearch(body) };
    }],
    ['GET', /^\/search\/([^/]+)$/, async ([id]) => {
      const job = searches.getJob(id);
      if (!job) throw fail(404, 'Job nicht gefunden');
      return job;
    }],

    ['GET', /^\/routes$/, () => store.listRoutes()],
    ['GET', /^\/routes\/([^/]+)$/, ([id]) => store.getRoute(id)],
    ['POST', /^\/routes$/, async (_p, body) => created(await store.createRoute(body))],
    ['PUT', /^\/routes\/([^/]+)$/, ([id], body) => store.updateRoute(id, body)],
    ['DELETE', /^\/routes\/([^/]+)$/, async ([id]) => (await store.deleteRoute(id), ok)],

    ['GET', /^\/merkliste$/, () => store.listMerkliste()],
    ['PUT', /^\/merkliste\/([^/]+)$/, ([adid], body) => (checkAdid(adid), store.putMerkliste(adid, body))],
    ['DELETE', /^\/merkliste\/([^/]+)$/, async ([adid]) => (await store.deleteMerkliste(adid), ok)],

    ['GET', /^\/contacts$/, () => store.listContacts()],
    ['PUT', /^\/contacts\/([^/]+)$/, ([adid], body) => (checkAdid(adid), store.putContactStatus(adid, body))],
    ['POST', /^\/contacts\/([^/]+)\/notes$/, async ([adid], body) => (checkAdid(adid), created(await store.addNote(adid, body)))],
    ['DELETE', /^\/contacts\/([^/]+)\/notes\/([^/]+)$/, async ([adid, noteId]) => (await store.deleteNote(adid, noteId), ok)],

    ['GET', /^\/mail\/status$/, () => NO_MAIL_STATUS],
    ['POST', /^\/mail\/check$/, () => NO_MAIL_STATUS],
    ['GET', /^\/mail\/notifications$/, () => ({ byAd: {}, unmatched: [] })],
    ['POST', /^\/mail\/seen\/([^/]+)$/, ([adid]) => (checkAdid(adid), ok)],
  ];

  /**
   * @param {string} method
   * @param {string} path e.g. "/api/routes/abc" or "/api/geocode?q=Kassel" ("/api" prefix optional)
   * @param {any} [body]
   * @returns {Promise<{status:number, json:any}>}
   */
  async function handle(method, path, body) {
    try {
      const [pathname, qs = ''] = String(path).split('?');
      const rel = pathname.replace(/^\/api(?=\/|$)/, '') || '/';
      const m = method.toUpperCase();
      for (const [rm, re, fn] of routes) {
        const hit = rm === m && re.exec(rel);
        if (!hit) continue;
        const out = await fn(hit.slice(1).map(decodeURIComponent), body, new URLSearchParams(qs));
        return out instanceof Created ? { status: 201, json: out.json } : { status: 200, json: out };
      }
      return { status: 404, json: { error: 'Unbekannter Endpunkt' } };
    } catch (e) {
      return { status: e.status || 500, json: { error: e.message } };
    }
  }

  return { handle, store, client };
}
