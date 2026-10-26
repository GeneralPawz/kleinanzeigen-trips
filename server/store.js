import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const STOP_RADII = [0, 5, 10, 20, 30, 50];
export const CONTACT_STATUSES = ['none', 'angeschrieben', 'antwort', 'vereinbart', 'abgeholt', 'abgesagt'];
export const MAX_RESULTS = 500;
export const MAX_NOTE_LEN = 2000;

export const defaultFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'user', 'store.json');

const fail = (status, message) => Object.assign(new Error(message), { status });
const bad = (m) => fail(400, m);
const notFound = (m) => fail(404, m);
const now = () => new Date().toISOString();
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => v === null || v === undefined || v === '' || num(v);

// --- validation --------------------------------------------------------------------------------
export function cleanWaypoints(w) {
  if (!Array.isArray(w) || w.length > 10) throw bad('waypoints: Array mit höchstens 10 Punkten erforderlich');
  return w.map((p) => {
    if (!isObj(p) || !num(p.lat) || !num(p.lon)) throw bad('waypoints: jeder Punkt braucht lat/lon');
    const radiusKm = p.radiusKm ?? 0;
    if (!STOP_RADII.includes(radiusKm)) throw bad(`radiusKm muss einer von ${STOP_RADII.join(', ')} sein`);
    return { label: String(p.label ?? '').slice(0, 200), lat: p.lat, lon: p.lon, radiusKm };
  });
}

function cleanItems(items) {
  if (!Array.isArray(items) || items.length > 50) throw bad('items: Array mit höchstens 50 Einträgen erforderlich');
  return items.map((i) => {
    if (!isObj(i) || typeof i.query !== 'string' || !i.query.trim()) throw bad('items: jedes Item braucht eine query');
    if (!numOrNull(i.minPrice) || !numOrNull(i.maxPrice)) throw bad('items: minPrice/maxPrice müssen Zahlen oder null sein');
    return {
      query: i.query.trim(),
      minPrice: i.minPrice === '' ? null : (i.minPrice ?? null),
      maxPrice: i.maxPrice === '' ? null : (i.maxPrice ?? null),
    };
  });
}

const ROUTE_FIELDS = {
  name: (v) => {
    if (typeof v !== 'string' || !v.trim() || v.length > 120) throw bad('name: 1–120 Zeichen erforderlich');
    return v.trim();
  },
  waypoints: cleanWaypoints,
  items: cleanItems,
  corridorKm: (v) => {
    if (!num(v) || v <= 0 || v > 200) throw bad('corridorKm muss eine Zahl in (0, 200] sein');
    return v;
  },
  geometry: (v) => {
    if (v === null) return null;
    if (!isObj(v) || v.type !== 'LineString' || !Array.isArray(v.coordinates)) {
      throw bad('geometry muss ein GeoJSON-LineString oder null sein');
    }
    return v;
  },
  distanceKm: (v) => {
    if (v !== null && !num(v)) throw bad('distanceKm muss eine Zahl oder null sein');
    return v;
  },
  durationMin: (v) => {
    if (v !== null && !num(v)) throw bad('durationMin muss eine Zahl oder null sein');
    return v;
  },
  results: (v) => {
    if (!Array.isArray(v) || v.some((r) => !isObj(r))) throw bad('results muss ein Array von Objekten sein');
    return v.slice(0, MAX_RESULTS);
  },
  searchedAt: (v) => {
    if (v !== null && (typeof v !== 'string' || Number.isNaN(Date.parse(v)))) {
      throw bad('searchedAt muss ein ISO-Zeitstempel oder null sein');
    }
    return v;
  },
};
const routeDefaults = () => ({
  waypoints: [],
  items: [],
  corridorKm: 20,
  geometry: null,
  distanceKm: null,
  durationMin: null,
  results: [],
  searchedAt: null,
});

function pickRouteFields(body) {
  if (!isObj(body)) throw bad('JSON-Objekt erwartet');
  const out = {};
  for (const [k, clean] of Object.entries(ROUTE_FIELDS)) if (k in body) out[k] = clean(body[k]);
  return out;
}

// --- store ---------------------------------------------------------------------------------------
/** JSON file store: whole state in memory, atomic write (temp file + rename) after each mutation. */
export function createStore(file = defaultFile) {
  let state = { routes: {}, merkliste: {}, contacts: {} };
  if (existsSync(file)) {
    try {
      state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch (e) {
      throw new Error(`${file} ist beschädigt: ${e.message}`);
    }
  }
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, file);
  };
  const newId = () => randomUUID().replace(/-/g, '').slice(0, 12);
  const contact = (adid) => (state.contacts[adid] ||= { status: 'none', notes: [], updatedAt: now() });

  return {
    listRoutes: () =>
      Object.values(state.routes)
        .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    getRoute(id) {
      const r = Object.hasOwn(state.routes, id) ? state.routes[id] : null;
      if (!r) throw notFound('Route nicht gefunden');
      return r;
    },
    createRoute(body) {
      const f = pickRouteFields(body);
      if (!('name' in f)) throw bad('name fehlt');
      const route = { id: newId(), ...routeDefaults(), ...f, updatedAt: now() };
      state.routes[route.id] = route;
      save();
      return route;
    },
    updateRoute(id, body) {
      const cur = this.getRoute(id);
      const route = { ...cur, ...pickRouteFields(body), id, updatedAt: now() };
      state.routes[id] = route;
      save();
      return route;
    },
    deleteRoute(id) {
      this.getRoute(id);
      delete state.routes[id];
      save();
    },

    listMerkliste: () => Object.values(state.merkliste).sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    putMerkliste(adid, body) {
      if (!isObj(body) || !isObj(body.ad)) throw bad('ad (Objekt) fehlt');
      const routeId = body.routeId ?? null;
      if (routeId !== null && typeof routeId !== 'string') throw bad('routeId muss ein String oder null sein');
      const entry = { adid, ad: { ...body.ad, adid }, routeId, savedAt: state.merkliste[adid]?.savedAt || now() };
      state.merkliste[adid] = entry;
      save();
      return entry;
    },
    deleteMerkliste(adid) {
      if (!Object.hasOwn(state.merkliste, adid)) throw notFound('Nicht in der Merkliste');
      delete state.merkliste[adid];
      save();
    },

    listContacts: () => state.contacts,
    putContactStatus(adid, body) {
      if (!isObj(body) || !CONTACT_STATUSES.includes(body.status)) {
        throw bad(`status muss einer von ${CONTACT_STATUSES.join(', ')} sein`);
      }
      const c = contact(adid);
      c.status = body.status;
      c.updatedAt = now();
      save();
      return c;
    },
    addNote(adid, body) {
      const text = isObj(body) && typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_NOTE_LEN) throw bad(`text: 1–${MAX_NOTE_LEN} Zeichen erforderlich`);
      const c = contact(adid);
      const note = { id: newId(), text, at: now() };
      c.notes.push(note);
      c.updatedAt = note.at;
      save();
      return note;
    },
    deleteNote(adid, noteId) {
      const c = Object.hasOwn(state.contacts, adid) ? state.contacts[adid] : null;
      const i = c ? c.notes.findIndex((n) => n.id === noteId) : -1;
      if (i < 0) throw notFound('Notiz nicht gefunden');
      c.notes.splice(i, 1);
      c.updatedAt = now();
      save();
    },
  };
}

let shared;
/** Lazily created default store (data/user/store.json); the file is written on first mutation. */
export const getStore = () => (shared ||= createStore(process.env.TROEDEL_STORE || defaultFile));
