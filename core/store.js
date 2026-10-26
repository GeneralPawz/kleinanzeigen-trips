export const STOP_RADII = [0, 5, 10, 20, 30, 50];
export const CONTACT_STATUSES = ['none', 'angeschrieben', 'antwort', 'vereinbart', 'abgeholt', 'abgesagt'];
export const MAX_RESULTS = 500;
export const MAX_NOTE_LEN = 2000;

export const SEARCH_MODES = ['corridor', 'radius'];

/** Random 12-char hex id (crypto.randomUUID where available, e.g. Node and secure WebViews). */
export function newId() {
  const u = globalThis.crypto?.randomUUID?.() ?? Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return u.replace(/-/g, '').slice(0, 12);
}

export const fail = (status, message) => Object.assign(new Error(message), { status });
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
    if (!num(v) || v < 0 || v > 200) throw bad('corridorKm muss eine Zahl in [0, 200] sein');
    return v;
  },
  searchMode: (v) => {
    if (!SEARCH_MODES.includes(v)) throw bad(`searchMode muss einer von ${SEARCH_MODES.join(', ')} sein`);
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
/**
 * Routes / Merkliste / contacts over an injected storage adapter `{ load(): Promise<obj>, save(obj): Promise<void> }`.
 * The whole state lives in memory after the first load; every mutation saves it. Calls are serialized.
 */
export function createStore(storage) {
  /** @type {{routes: Record<string,any>, merkliste: Record<string,any>, contacts: Record<string,any>}|null} */
  let state = null;
  let chain = Promise.resolve();
  /** Runs fn(state) exclusively; fn returns [result, mutated]. */
  const run = (fn) => {
    const p = chain.then(async () => {
      if (!state) state = { routes: {}, merkliste: {}, contacts: {}, ...((await storage.load()) || {}) };
      const [result, mutated] = fn(state);
      if (mutated) await storage.save(state);
      return result;
    });
    chain = p.catch(() => {});
    return p;
  };
  const read = (fn) => run((s) => [fn(s), false]);
  const write = (fn) => run((s) => [fn(s), true]);
  const contact = (s, adid) => (s.contacts[adid] ||= { status: 'none', notes: [], updatedAt: now() });
  const getRoute = (s, id) => {
    const r = Object.hasOwn(s.routes, id) ? s.routes[id] : null;
    if (!r) throw notFound('Route nicht gefunden');
    return r;
  };

  return {
    listRoutes: () =>
      read((s) =>
        Object.values(s.routes)
          .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ),
    getRoute: (id) => read((s) => getRoute(s, id)),
    createRoute: (body) =>
      write((s) => {
        const f = pickRouteFields(body);
        if (!('name' in f)) throw bad('name fehlt');
        const route = { id: newId(), ...routeDefaults(), ...f, updatedAt: now() };
        s.routes[route.id] = route;
        return route;
      }),
    updateRoute: (id, body) =>
      write((s) => {
        const cur = getRoute(s, id);
        const route = { ...cur, ...pickRouteFields(body), id, updatedAt: now() };
        s.routes[id] = route;
        return route;
      }),
    deleteRoute: (id) =>
      write((s) => {
        getRoute(s, id);
        delete s.routes[id];
      }),

    listMerkliste: () => read((s) => Object.values(s.merkliste).sort((a, b) => b.savedAt.localeCompare(a.savedAt))),
    putMerkliste: (adid, body) =>
      write((s) => {
        if (!isObj(body) || !isObj(body.ad)) throw bad('ad (Objekt) fehlt');
        const routeId = body.routeId ?? null;
        if (routeId !== null && typeof routeId !== 'string') throw bad('routeId muss ein String oder null sein');
        const entry = { adid, ad: { ...body.ad, adid }, routeId, savedAt: s.merkliste[adid]?.savedAt || now() };
        s.merkliste[adid] = entry;
        return entry;
      }),
    deleteMerkliste: (adid) =>
      write((s) => {
        if (!Object.hasOwn(s.merkliste, adid)) throw notFound('Nicht in der Merkliste');
        delete s.merkliste[adid];
      }),

    listContacts: () => read((s) => s.contacts),
    putContactStatus: (adid, body) =>
      write((s) => {
        if (!isObj(body) || !CONTACT_STATUSES.includes(body.status)) {
          throw bad(`status muss einer von ${CONTACT_STATUSES.join(', ')} sein`);
        }
        const c = contact(s, adid);
        c.status = body.status;
        c.updatedAt = now();
        return c;
      }),
    addNote: (adid, body) =>
      write((s) => {
        const text = isObj(body) && typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > MAX_NOTE_LEN) throw bad(`text: 1–${MAX_NOTE_LEN} Zeichen erforderlich`);
        const c = contact(s, adid);
        const note = { id: newId(), text, at: now() };
        c.notes.push(note);
        c.updatedAt = note.at;
        return note;
      }),
    deleteNote: (adid, noteId) =>
      write((s) => {
        const c = Object.hasOwn(s.contacts, adid) ? s.contacts[adid] : null;
        const i = c ? c.notes.findIndex((n) => n.id === noteId) : -1;
        if (i < 0) throw notFound('Notiz nicht gefunden');
        c.notes.splice(i, 1);
        c.updatedAt = now();
      }),
  };
}

/** In-memory storage adapter (tests, ephemeral use). */
export function memoryStorage(initial = {}) {
  let data = structuredClone(initial);
  return {
    load: async () => structuredClone(data),
    save: async (obj) => {
      data = structuredClone(obj);
    },
  };
}

