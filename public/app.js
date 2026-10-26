// Trödeltour frontend – plain ES module, talks to the backend per docs/API.md
const L = window.L;

const $ = (id) => document.getElementById(id);
const PALETTE = ['#326916', '#E8590C', '#1C7ED6', '#B5E941', '#9C36B5', '#C2255C', '#0B7285', '#F08C00', '#1D4B00', '#5C940D'];
const OLD_STORE_KEY = 'troedeltour.v1';
const LAST_ROUTE_KEY = 'troedeltour.lastRoute';
const DEBOUNCE_MS = 650;
const SAVE_MS = 900;
const POLL_MS = 1500;
const RADII = [0, 5, 10, 20, 30, 50];
const MAX_STOPS = 10;
const BUBBLE_ZOOM = 12;
const INBOX_URL = 'https://www.kleinanzeigen.de/m-nachrichten.html';
const STATUS = {
  none: { label: 'Kein Kontakt', chip: '' },
  angeschrieben: { label: 'Angeschrieben', chip: 'angeschrieben' },
  antwort: { label: 'Antwort erhalten', chip: 'Antwort' },
  vereinbart: { label: 'Termin vereinbart', chip: 'vereinbart' },
  abgeholt: { label: 'Abgeholt', chip: 'abgeholt' },
  abgesagt: { label: 'Abgesagt', chip: 'abgesagt' },
};
const ICONS = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>',
};
const THEME_KEY = 'troedeltour.theme';
const MODE_KEY = 'troedeltour.mode.'; // + routeId: fallback while the server store does not keep searchMode
const APP_VERSION = '2.1.0';
// Backend (search.js/store.js) rejects corridorKm <= 0; in radius mode a hairline corridor keeps only stop hits.
const RADIUS_MODE_CORRIDOR_KM = 0;
const PHONE_MQ = window.matchMedia('(max-width: 799px)');

let uid = 0;
const nextId = () => `n${++uid}`;

/** @type {{stops: {id:string,text:string,point:{lat:number,lon:number}|null,radiusKm:number}[], items: {id:string,query:string,minPrice:string,maxPrice:string}[], corridor:number, mode: 'corridor'|'radius', route: any, routeId: string|null, routeName: string, nameAuto: boolean, searchedAt: string|null}} */
const state = { stops: [], items: [], corridor: 20, mode: 'corridor', route: null, routeId: null, routeName: '', nameAuto: true, searchedAt: null };
let results = [];
let resultsById = new Map();
let shown = [];
let filterQuery = null;
let searchStatus = null;
let pollTimer = null;
let searchToken = 0;
let selectedAdid = null;
let merk = new Map(); // adid -> { adid, ad, routeId, savedAt }
let contacts = {}; // adid -> { status, notes, updatedAt }
let routesCache = [];
let mailStatus = { configured: false, provider: null, user: null, lastCheck: null, error: null };
let mailByAd = {}; // adid -> { count, unseen, lastAt, lastSubject, link, match }
let mailUnmatched = [];
let mailTimer = null;
const MAIL_POLL_MS = 60000;
const unseenOf = (adid) => mailByAd[adid]?.unseen || 0;

// ---------- helpers ----------
// Every request goes through api(). window.TROEDEL_API_BASE (e.g. 'http://192.168.1.5:3000' in an Android WebView) prefixes '/api/…'; '' = same origin.
const API_BASE = String(window.TROEDEL_API_BASE || '').replace(/\/+$/, '');
// window.TROEDEL_LOCAL_API ({ handle(method, path, body) → {status, json} }) answers /api/… in-process (Android app, no server).
async function api(path, opts = {}) {
  if (window.TROEDEL_LOCAL_API) {
    const { status, json } = await window.TROEDEL_LOCAL_API.handle(opts.method || 'GET', path, opts.body);
    if (status >= 400) throw new Error((json && json.error) || `Fehler ${status}`);
    return json;
  }
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `Fehler ${res.status}`);
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstElementChild;
}

const enc = encodeURIComponent;
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const fmtKm = (n) => (Math.round(n * 10) / 10).toLocaleString('de-DE');
const fmtDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
};
const shortLabel = (text) => String(text || '').split(',')[0].trim();
function fmtDuration(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function showMsg(node, msg) {
  node.textContent = msg || '';
  node.hidden = !msg;
}
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast${isErr ? ' err' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function setResults(list) {
  results = Array.isArray(list) ? list : [];
  resultsById = new Map(results.map((r) => [r.adid, r]));
}
const adById = (adid) => resultsById.get(adid) || merk.get(adid)?.ad || null;
const isNear = (r) => r && r.nearStop;

// ---------- persistence (saved routes) ----------
let dirty = false;
let saveTimer = null;
let saveChain = Promise.resolve();

function autoName() {
  const a = shortLabel(state.stops[0]?.text), b = shortLabel(state.stops[state.stops.length - 1]?.text);
  return a && b ? `${a}–${b}` : '';
}

function numOrNull(v) { return v !== '' && v != null && isFinite(+v) ? +v : null; }

function routePayload() {
  return {
    name: state.routeName.trim() || autoName() || 'Neue Route',
    waypoints: state.stops.filter((s) => s.point).map((s) => ({ label: s.text, lat: s.point.lat, lon: s.point.lon, radiusKm: s.radiusKm || 0 })),
    items: state.items.filter((i) => i.query.trim()).map((i) => ({ query: i.query.trim(), minPrice: numOrNull(i.minPrice), maxPrice: numOrNull(i.maxPrice) })),
    corridorKm: state.corridor,
    searchMode: state.mode,
    geometry: state.route ? state.route.geometry : null,
    distanceKm: state.route ? state.route.distanceKm : null,
    durationMin: state.route ? state.route.durationMin : null,
    results,
    searchedAt: state.searchedAt,
  };
}

async function doSave() {
  if (!dirty || (!state.routeId && !state.route)) return;
  dirty = false;
  try {
    const body = routePayload();
    if (state.routeId) {
      await api(`/api/routes/${enc(state.routeId)}`, { method: 'PUT', body });
    } else {
      const r = await api('/api/routes', { method: 'POST', body });
      state.routeId = r.id;
      localStorage.setItem(LAST_ROUTE_KEY, r.id);
    }
    localStorage.setItem(MODE_KEY + state.routeId, state.mode);
  } catch (e) {
    dirty = true;
    toast(`Route konnte nicht gespeichert werden: ${e.message}`, true);
  }
}

/** Mark the current route as changed; saves after a short debounce (or immediately with `now`). */
function persist(now = false) {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, now ? 0 : SAVE_MS);
}
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  saveChain = saveChain.then(doSave);
  return saveChain;
}

// ---------- map ----------
const map = L.map('map').setView([51.16, 10.45], 6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);
const adLayer = L.layerGroup().addTo(map);
const markers = new Map(); // adid -> marker
let routeLine = null;

function endIcon(kind, label) {
  return L.divIcon({ className: '', html: `<div class="endpin ${kind}">${label}</div>`, iconSize: kind === 'via' ? [22, 22] : [30, 30], iconAnchor: kind === 'via' ? [11, 11] : [15, 15] });
}

const roleOf = (i, n) => (i === 0 ? 'Start' : i === n - 1 ? 'Ziel' : `Stopp ${i}`);

function drawStops() {
  stopLayer.clearLayers();
  const n = state.stops.length;
  state.stops.forEach((s, i) => {
    if (!s.point) return;
    const last = i === n - 1;
    const kind = i === 0 ? 'start' : last ? 'end' : 'via';
    const label = i === 0 ? 'S' : last ? 'Z' : String(i);
    if (state.mode === 'radius' && s.radiusKm > 0) {
      L.circle([s.point.lat, s.point.lon], {
        radius: s.radiusKm * 1000, color: '#326916', weight: 2, fillColor: '#B5E941', fillOpacity: 0.18, interactive: false,
      }).addTo(stopLayer);
    }
    L.marker([s.point.lat, s.point.lon], { icon: endIcon(kind, label), title: `${roleOf(i, n)}: ${s.text}`, zIndexOffset: 500 }).addTo(stopLayer);
  });
}

function drawRoute(fit) {
  routeLayer.clearLayers();
  routeLine = null;
  if (!state.route) { $('route-info').textContent = ''; return; }
  routeLine = L.geoJSON(state.route.geometry, { style: { color: '#1D4B00', weight: 5, opacity: 0.85 } }).addTo(routeLayer);
  if (fit) map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
  $('route-info').textContent = `${fmtKm(state.route.distanceKm)} km · ${fmtDuration(state.route.durationMin)} Fahrzeit`;
}

// ---------- route inputs ----------
const suggestState = { timers: new Map(), seq: new Map() };

function newStop(text = '') { return { id: nextId(), text, point: null, radiusKm: 0 }; }

function radiusText(km) { return km ? `${km} km` : '– km'; }

function renderStops() {
  const list = $('stops');
  list.replaceChildren();
  const n = state.stops.length;
  state.stops.forEach((stop, i) => {
    const role = roleOf(i, n);
    const inputId = `stop-${stop.id}`;
    const input = el('input', {
      type: 'text', id: inputId, value: stop.text, autocomplete: 'off', placeholder: i === 0 ? 'z. B. Hamburg' : i === n - 1 ? 'z. B. München' : 'Ort oder PLZ',
      'aria-autocomplete': 'list', 'aria-controls': `sug-${stop.id}`,
    });
    input.value = stop.text;
    if (stop.point) input.classList.add('resolved');
    const sug = el('ul', { class: 'suggest', id: `sug-${stop.id}`, hidden: true });
    input.addEventListener('input', () => {
      stop.text = input.value;
      stop.point = null;
      input.classList.remove('resolved');
      scheduleSuggest(stop, input, sug);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') sug.hidden = true; });
    input.addEventListener('blur', () => setTimeout(() => { if (!sug.contains(document.activeElement)) sug.hidden = true; }, 150));

    const rb = el('button', {
      type: 'button', id: `radius-${stop.id}`, class: `radius-btn${stop.radiusKm ? ' on' : ''}`,
      'aria-label': `${role}: Suchumkreis ${stop.radiusKm ? `${stop.radiusKm} km` : 'aus'} – klicken zum Ändern`,
      'aria-disabled': state.mode === 'corridor' ? 'true' : null,
      title: state.mode === 'corridor' ? 'Nur im Modus „Um Orte“ verfügbar' : 'Suchumkreis um diesen Ort (aus, 5, 10, 20, 30, 50 km)', onclick: () => cycleRadius(stop),
    }, `◎ ${radiusText(stop.radiusKm)}`);
    const handle = el('button', { type: 'button', class: 'drag-handle', 'aria-hidden': 'true', tabindex: '-1', title: 'Ziehen zum Sortieren', text: '⋮⋮' });
    handle.addEventListener('pointerdown', (e) => startDrag(e, handle, i));
    const up = el('button', { type: 'button', class: 'icon-btn up', 'aria-label': `${role} nach oben`, title: 'Nach oben', text: '↑', disabled: i === 0, onclick: () => moveStop(i, -1) });
    const down = el('button', { type: 'button', class: 'icon-btn down', 'aria-label': `${role} nach unten`, title: 'Nach unten', text: '↓', disabled: i === n - 1, onclick: () => moveStop(i, 1) });
    const rm = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `${role} entfernen`, title: 'Entfernen', text: '×', disabled: n <= 2, onclick: () => removeStop(i) });
    list.append(el('li', { class: 'stop' },
      el('label', { for: inputId, text: role }),
      el('div', { class: 'stop-line' }, handle, el('div', { class: 'field' }, input, sug), rb, up, down, rm)));
  });
  $('add-stop').disabled = n >= MAX_STOPS;
  drawStops();
}

function cycleRadius(stop) {
  if (state.mode !== 'radius') { toast('Der Radius je Stopp gilt nur im Modus „Um Orte“. Wechsle den Suchmodus oben bei „Suche“.'); return; }
  stop.radiusKm = RADII[(RADII.indexOf(stop.radiusKm) + 1) % RADII.length];
  renderStops();
  $(`radius-${stop.id}`)?.focus();
  showMsg($('mode-error'), '');
  persist();
}
function moveStop(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.stops.length) return;
  [state.stops[i], state.stops[j]] = [state.stops[j], state.stops[i]];
  renderStops();
  staleHint();
  persist();
  $('stops').children[j]?.querySelector(d < 0 ? '.up' : '.down')?.focus();
}
/** The saved route line no longer matches the order of the stops. */
function staleHint() {
  if (state.route) $('route-info').textContent = `${$('route-info').textContent.split(' – Reihenfolge')[0]} – Reihenfolge geändert, bitte „Route berechnen“ klicken`;
}

/** Drag & drop with Pointer Events (touch + mouse): the handle follows the pointer, other stops slide aside. */
function startDrag(e, handle, from) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const items = [...$('stops').children];
  if (items.length < 2) return;
  const rects = items.map((n) => n.getBoundingClientRect());
  const slot = rects[1].top - rects[0].top;
  const li = items[from];
  const startY = e.clientY;
  let target = from;
  handle.setPointerCapture(e.pointerId);
  li.classList.add('dragging');
  document.body.classList.add('dragging-stop');
  items.forEach((n, j) => { if (j !== from) n.classList.add('shifting'); });
  const onMove = (ev) => {
    const dy = ev.clientY - startY;
    li.style.transform = `translateY(${dy}px)`;
    const mid = rects[from].top + dy + rects[from].height / 2;
    target = rects.reduce((n, r, j) => n + (j !== from && r.top + r.height / 2 < mid ? 1 : 0), 0);
    items.forEach((n, j) => {
      if (j === from) return;
      const shift = from < target && j > from && j <= target ? -slot : from > target && j < from && j >= target ? slot : 0;
      n.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const finish = (ev) => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    document.body.classList.remove('dragging-stop');
    items.forEach((n) => { n.classList.remove('dragging', 'shifting'); n.style.transform = ''; });
    if (ev.type === 'pointerup' && target !== from) {
      const [moved] = state.stops.splice(from, 1);
      state.stops.splice(target, 0, moved);
      renderStops();
      staleHint();
      persist();
    }
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}
function removeStop(i) {
  if (state.stops.length <= 2) return;
  state.stops.splice(i, 1);
  renderStops();
  staleHint();
  persist();
}

function scheduleSuggest(stop, input, sug) {
  clearTimeout(suggestState.timers.get(stop.id));
  const q = input.value.trim();
  if (q.length < 3) { sug.hidden = true; return; }
  suggestState.timers.set(stop.id, setTimeout(async () => {
    const seq = (suggestState.seq.get(stop.id) || 0) + 1;
    suggestState.seq.set(stop.id, seq);
    try {
      const hits = await api(`/api/geocode?q=${enc(q)}`);
      if (suggestState.seq.get(stop.id) !== seq || input.value.trim() !== q) return;
      sug.replaceChildren();
      if (!hits.length) sug.append(el('li', { class: 'none', text: 'Keine Treffer' }));
      for (const h of hits) {
        sug.append(el('li', {}, el('button', {
          type: 'button', text: h.label,
          onclick: () => { applyGeocode(stop, input, h); sug.hidden = true; },
        })));
      }
      sug.hidden = false;
    } catch {
      sug.hidden = true;
    }
  }, DEBOUNCE_MS));
}

function applyGeocode(stop, input, h) {
  stop.text = h.label;
  stop.point = { lat: h.lat, lon: h.lon };
  input.value = h.label;
  input.classList.add('resolved');
  drawStops();
}

async function calcRoute() {
  const err = $('route-error');
  showMsg(err, '');
  const btn = $('calc-route');
  btn.disabled = true;
  btn.textContent = 'Berechne…';
  try {
    for (const stop of state.stops) {
      if (stop.point) continue;
      const q = stop.text.trim();
      if (!q) throw new Error('Bitte Start und Ziel ausfüllen.');
      const hits = await api(`/api/geocode?q=${enc(q)}`);
      if (!hits.length) throw new Error(`Ort nicht gefunden: „${q}“`);
      stop.point = { lat: hits[0].lat, lon: hits[0].lon };
      stop.text = hits[0].label;
    }
    renderStops();
    const waypoints = state.stops.map((s) => ({ lat: s.point.lat, lon: s.point.lon }));
    state.route = await api('/api/route', { method: 'POST', body: { waypoints } });
    clearResults();
    state.searchedAt = null;
    if (state.nameAuto || !state.routeName.trim()) {
      state.routeName = autoName();
      state.nameAuto = true;
      $('route-name').value = state.routeName;
    }
    drawRoute(true);
    persist(true);
  } catch (e) {
    showMsg(err, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Route berechnen';
  }
}

// ---------- items ----------
const blankItem = () => ({ id: nextId(), query: '', minPrice: '', maxPrice: '' });

function renderItems() {
  const list = $('items');
  list.replaceChildren();
  state.items.forEach((item, i) => {
    const q = el('input', { type: 'text', id: `q-${item.id}`, value: item.query, placeholder: 'z. B. Fahrrad', autocomplete: 'off' });
    const min = el('input', { type: 'number', id: `min-${item.id}`, value: item.minPrice, min: '0', inputmode: 'numeric', placeholder: '€' });
    const max = el('input', { type: 'number', id: `max-${item.id}`, value: item.maxPrice, min: '0', inputmode: 'numeric', placeholder: '€' });
    q.value = item.query; min.value = item.minPrice; max.value = item.maxPrice;
    q.addEventListener('input', () => { item.query = q.value; persist(); });
    min.addEventListener('input', () => { item.minPrice = min.value; persist(); });
    max.addEventListener('input', () => { item.maxPrice = max.value; persist(); });
    const rm = el('button', { type: 'button', class: 'icon-btn remove', 'aria-label': `Suchbegriff ${i + 1} entfernen`, title: 'Entfernen', text: '×', disabled: state.items.length <= 1, onclick: () => { state.items.splice(i, 1); renderItems(); persist(); } });
    list.append(el('li', { class: 'item' },
      el('div', {}, el('label', { for: q.id, text: `Gesuchter Artikel ${i + 1}` }), q),
      el('div', {}, el('label', { for: min.id, text: 'Min €' }), min),
      el('div', {}, el('label', { for: max.id, text: 'Max €' }), max),
      rm));
  });
}

// ---------- search ----------
const colorFor = (query) => {
  const order = [...new Set(state.items.map((i) => i.query.trim()).filter(Boolean))];
  const idx = order.indexOf(query);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
};

function clearResults() {
  stopPolling();
  searchToken++;
  setResults([]);
  filterQuery = null;
  searchStatus = null;
  selectedAdid = null;
  $('progress-wrap').hidden = true;
  showMsg($('blocked'), '');
  $('blocked').hidden = true;
  renderResults();
}

function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

async function startSearch() {
  const err = $('search-error');
  showMsg(err, '');
  if (!state.route) { showMsg(err, 'Bitte zuerst eine Route berechnen.'); return; }
  const items = state.items
    .filter((i) => i.query.trim())
    .map((i) => {
      const o = { query: i.query.trim() };
      if (i.minPrice !== '' && isFinite(+i.minPrice)) o.minPrice = +i.minPrice;
      if (i.maxPrice !== '' && isFinite(+i.maxPrice)) o.maxPrice = +i.maxPrice;
      return o;
    });
  if (!items.length) { showMsg(err, 'Bitte mindestens einen Suchbegriff eingeben.'); return; }
  const radiusMode = state.mode === 'radius';
  const stops = radiusMode
    ? state.stops
      .filter((s) => s.point && s.radiusKm > 0)
      .map((s) => ({ label: shortLabel(s.text), lat: s.point.lat, lon: s.point.lon, radiusKm: s.radiusKm }))
    : [];
  showMsg($('mode-error'), '');
  if (radiusMode && !stops.length) {
    showMsg($('mode-error'), 'Bitte bei mindestens einem Stopp einen Radius wählen (◎) – oder wechsle auf „Entlang der Route“.');
    return;
  }
  clearResults();
  state.searchedAt = null;
  const token = searchToken;
  const btn = $('search');
  btn.disabled = true;
  btn.textContent = 'Suche läuft…';
  $('progress-wrap').hidden = false;
  $('progress').removeAttribute('value');
  $('progress-text').textContent = 'Suche wird gestartet…';
  try {
    const body = { geometry: state.route.geometry, corridorKm: radiusMode ? RADIUS_MODE_CORRIDOR_KM : state.corridor, items };
    if (radiusMode) body.stops = stops;
    const { jobId } = await api('/api/search', { method: 'POST', body });
    if (token !== searchToken) return;
    poll(jobId, token);
  } catch (e) {
    showMsg(err, e.message);
    finishSearch();
  }
}

function finishSearch() {
  const btn = $('search');
  btn.disabled = false;
  btn.textContent = state.mode === 'radius' ? 'Um die Orte suchen' : 'Entlang der Route suchen';
}

// ---------- search mode (corridor XOR radius per stop) ----------
function applyMode({ redraw = true } = {}) {
  const radius = state.mode === 'radius';
  for (const b of document.querySelectorAll('#mode-seg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  $('corridor').disabled = radius;
  $('corridor-box').classList.toggle('is-off', radius);
  for (const b of document.querySelectorAll('.radius-btn')) {
    if (radius) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    b.title = radius ? 'Suchumkreis um diesen Ort (aus, 5, 10, 20, 30, 50 km)' : 'Nur im Modus „Um Orte“ verfügbar';
  }
  $('mode-hint').textContent = radius
    ? 'Gesucht wird nur im Umkreis der Stopps, bei denen du einen Radius (◎) gesetzt hast – nicht entlang der ganzen Route.'
    : 'Gesucht wird links und rechts der gesamten Route. Die Radien bei den Stopps sind in diesem Modus aus.';
  showMsg($('mode-error'), '');
  if (!$('search').disabled) finishSearch();
  if (redraw) drawStops();
}
function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  applyMode();
  persist();
}
function initialMode(r) {
  if (r.searchMode === 'corridor' || r.searchMode === 'radius') return r.searchMode;
  const kept = r.id ? localStorage.getItem(MODE_KEY + r.id) : null;
  return kept === 'radius' ? 'radius' : 'corridor';
}

async function poll(jobId, token) {
  try {
    const job = await api(`/api/search/${enc(jobId)}`);
    if (token !== searchToken) return;
    searchStatus = job.status;
    const { done = 0, total = 0 } = job.progress || {};
    const bar = $('progress');
    if (total > 0) { bar.max = total; bar.value = done; } else bar.removeAttribute('value');
    $('progress-text').textContent = job.status === 'running'
      ? `Suche ${done} von ${total || '?'} Abschnitten…`
      : job.status === 'done' ? `Fertig – ${job.results.length} Anzeigen gefunden.` : `${job.results.length} Anzeigen gefunden.`;
    if (Array.isArray(job.results)) {
      const changed = job.results.length !== results.length;
      setResults(job.results);
      if (changed || job.status !== 'running') renderResults();
    }
    if (job.status === 'running') {
      pollTimer = setTimeout(() => poll(jobId, token), POLL_MS);
      return;
    }
    if (job.status === 'blocked') $('blocked').hidden = false;
    if (job.status === 'error') showMsg($('search-error'), job.error || 'Die Suche ist fehlgeschlagen.');
    if (job.status === 'done') bar.value = bar.max;
    if (job.status === 'done' || job.status === 'blocked') {
      state.searchedAt = new Date().toISOString();
      persist(true);
    }
    finishSearch();
  } catch (e) {
    if (token !== searchToken) return;
    showMsg($('search-error'), e.message);
    finishSearch();
  }
}

// ---------- results ----------
function renderResults() {
  const section = $('results-section');
  section.hidden = !results.length && !searchStatus;
  const queries = [...new Set(results.map((r) => r.query))];
  if (filterQuery && !queries.includes(filterQuery)) filterQuery = null;

  const chips = $('chips');
  chips.replaceChildren();
  const mkChip = (label, q, count, color) => el('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(filterQuery === q),
    onclick: () => { filterQuery = q; renderResults(); },
  }, color ? el('span', { class: 'dot', style: `background:${color}` }) : null, `${label} (${count})`);
  chips.append(mkChip('Alle', null, results.length));
  for (const q of queries) chips.append(mkChip(q, q, results.filter((r) => r.query === q).length, colorFor(q)));
  chips.hidden = queries.length < 2;

  shown = results.filter((r) => !filterQuery || r.query === filterQuery).sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
  $('result-count').textContent = results.length ? `(${shown.length})` : '';
  const list = $('results');
  list.replaceChildren();
  if (!shown.length) {
    list.append(el('li', { class: 'empty-note', text: searchStatus === 'running' ? 'Noch keine Treffer …' : (state.mode === 'radius' ? 'Keine Anzeigen im Umkreis der Stopps gefunden.' : 'Keine Anzeigen im Korridor gefunden.') }));
  }
  for (const r of shown) list.append(card(r));
  drawAdMarkers();
}

function priceNode(r, cls) {
  let text = r.priceText || (r.price != null ? `${r.price} €` : 'Preis auf Anfrage');
  const vb = r.vb || /\bVB\s*$/i.test(text);
  text = text.replace(/\s*VB\s*$/i, '');
  const node = el('div', { class: cls, text });
  if (vb) node.append(el('span', { class: 'vb', text: 'VB' }));
  return node;
}

function thumbNode(r, cls = 'thumb') {
  const empty = () => el('div', { class: `${cls} empty`, text: cls === 'thumb' ? 'Kein Bild' : '' });
  if (!safeUrl(r.image)) return empty();
  const img = el('img', { class: cls, src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(empty()));
  return img;
}

function heartBtn(adid) {
  const on = merk.has(adid);
  return el('button', {
    type: 'button', class: `heart-btn${on ? ' on' : ''}`, 'data-act': 'heart', 'aria-pressed': String(on), 'aria-label': 'Merkliste',
    title: on ? 'Von der Merkliste entfernen' : 'Auf die Merkliste',
    onclick: (e) => { e.stopPropagation(); toggleMerk(adid); },
  }, icon('heart'));
}

function chatChip(adid) {
  const st = contacts[adid]?.status || 'none';
  const unseen = unseenOf(adid);
  const mailTxt = unseen ? ` – ${unseen} neue Nachricht${unseen > 1 ? 'en' : ''} per E-Mail` : '';
  return el('button', {
    type: 'button', class: 'chat-chip', 'data-act': 'chat', 'data-status': st, 'aria-label': `Kontakt: ${STATUS[st].label}${mailTxt}`,
    title: `Kontakt: ${STATUS[st].label}${mailTxt}`, onclick: (e) => { e.stopPropagation(); openContact(adid); },
  }, icon('chat'), STATUS[st].chip ? el('span', { text: STATUS[st].chip }) : null,
  unseen ? el('span', { class: 'mail-badge', text: String(unseen) }) : null);
}

function fillActions(box, r) {
  const act = box.contains(document.activeElement) ? document.activeElement.dataset.act : null;
  const link = safeUrl(r.url);
  box.replaceChildren(
    link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Anzeige öffnen', el('span', { class: 'sr-only', text: ` – ${r.title}` })) : el('span'),
    el('span', { class: 'spacer' }),
    heartBtn(r.adid), chatChip(r.adid));
  if (act) box.querySelector(`[data-act=${act}]`)?.focus();
}

function card(r) {
  const color = colorFor(r.query);
  const actions = el('div', { class: 'actions' });
  fillActions(actions, r);
  const li = el('li', {
    class: `listing${merk.has(r.adid) ? ' remembered' : ''}${r.adid === selectedAdid ? ' sel' : ''}`, id: `card-${r.adid}`, style: `--c:${color}`,
    tabindex: '0', title: 'Auf der Karte zeigen',
  },
  thumbNode(r),
  el('div', {},
    el('div', { class: 'tag', text: r.query }),
    el('h3', { text: r.title }),
    priceNode(r, 'price'),
    el('div', { class: 'meta', text: `${[r.plz, r.city].filter(Boolean).join(' ')}` }),
    el('div', { class: 'meta', text: `km ${Math.round(r.kmAlongRoute)} der Route · ${fmtKm(r.distanceToRouteKm)} km abseits` }),
    isNear(r) ? el('div', { class: 'meta near', text: `in der Nähe von ${r.nearStop}${r.distanceToStopKm != null ? ` (${fmtKm(r.distanceToStopKm)} km)` : ''}` }) : null,
    r.date ? el('div', { class: 'meta', text: r.date }) : null,
    actions));
  li.addEventListener('click', (e) => { if (!e.target.closest('a, button, input, select, textarea')) selectAd(r.adid); });
  li.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === li) { e.preventDefault(); selectAd(r.adid); }
  });
  li.addEventListener('mouseenter', () => highlight(r.adid, true));
  li.addEventListener('mouseleave', () => highlight(r.adid, false));
  li.addEventListener('focusin', () => highlight(r.adid, true));
  li.addEventListener('focusout', () => highlight(r.adid, false));
  return li;
}

/** Re-sync card, pin, contact aside and Merkliste after merk/contact data of one ad changed. */
function onAdChanged(adid) {
  const r = adById(adid);
  const li = $(`card-${adid}`);
  if (li && r) {
    li.classList.toggle('remembered', merk.has(adid));
    fillActions(li.querySelector('.actions'), r);
  }
  const m = markers.get(adid);
  if (m && resultsById.has(adid)) m.setIcon(iconFor(resultsById.get(adid)));
  updateMerkCount();
  if (activeOverlay === 'contact' && contactAdid === adid) syncAside();
  if (activeOverlay === 'nav' && currentTab === 'merk') renderMerk();
}

// ---------- ad markers ----------
function highlight(adid, on) {
  const m = markers.get(adid);
  if (!m) return;
  m.getElement()?.querySelector('.pin, .bubble')?.classList.toggle('hl', on);
  m.setZIndexOffset(on || adid === selectedAdid ? 1000 : 0);
  const c = $(`card-${adid}`);
  if (c && !on) c.classList.remove('hl');
}

const bubbleWidth = () => (window.innerWidth < 800 ? 214 : 236);
const bubbleMode = () => map.getZoom() >= BUBBLE_ZOOM;

function dotIcon(r) {
  const remembered = merk.has(r.adid);
  const dot = el('div', { class: `pin${r.adid === selectedAdid ? ' sel' : ''}`, style: `--c:${colorFor(r.query)}` });
  if (remembered) dot.append(el('span', { class: 'pin-heart' }, icon('heart')));
  if (unseenOf(r.adid)) dot.append(el('span', { class: 'pin-mail' }));
  return L.divIcon({ className: '', html: dot, iconSize: [22, 22], iconAnchor: [11, 11] });
}

const BUBBLE_H = 70, LIFT = 78;
const placement = new Map(); // adid -> { dx, lift } (bubble offset so overlapping bubbles stay readable)

function bubbleIcon(r) {
  const remembered = merk.has(r.adid);
  const w = bubbleWidth();
  const { dx = 0, lift = 0 } = placement.get(r.adid) || {};
  const link = safeUrl(r.url);
  const btns = el('div', { class: 'b-btns' }, heartBtn(r.adid), chatChip(r.adid),
    link ? el('a', { class: 'ka-btn', href: link, target: '_blank', rel: 'noopener noreferrer', title: 'Auf Kleinanzeigen öffnen', 'aria-label': `Auf Kleinanzeigen öffnen: ${r.title}` }, icon('ext')) : null);
  L.DomEvent.disableClickPropagation(btns);
  const box = el('div', { class: `bubble${remembered ? ' remembered' : ''}${r.adid === selectedAdid ? ' sel' : ''}` },
    thumbNode(r, 'b-thumb'),
    el('div', { class: 'b-main' }, el('div', { class: 'b-title', text: r.title }), priceNode(r, 'b-price')),
    btns,
    remembered ? el('span', { class: 'b-badge' }, icon('heart')) : null);
  const px = w / 2 + dx; // x of the real location inside the bubble box
  const root = el('div', { class: 'bubble-root', style: `width:${w}px;height:${BUBBLE_H + lift}px;--c:${colorFor(r.query)};--lift:${lift}px;--px:${px}px` },
    box, lift ? el('div', { class: 'stem' }) : null, el('div', { class: 'tail' }));
  return L.divIcon({ className: '', html: root, iconSize: [w, BUBBLE_H + lift], iconAnchor: [px, BUBBLE_H + lift] });
}

const iconFor = (r) => (bubbleMode() ? bubbleIcon(r) : dotIcon(r));

/** Greedy layout: shift a bubble sideways / up until it no longer covers an already placed one. */
function layoutBubbles(spots) {
  placement.clear();
  const w = bubbleWidth();
  const placed = [];
  const tries = [[0, 0], [0.4, 0], [-0.4, 0], [0, 1], [0.4, 1], [-0.4, 1], [0, 2], [0.4, 2], [-0.4, 2]];
  const order = [...spots].sort((a, b) => (b.r.adid === selectedAdid) - (a.r.adid === selectedAdid) || b.lat - a.lat);
  for (const { r, ll } of order) {
    const p = map.latLngToContainerPoint(ll);
    let best = null;
    for (const [fx, lv] of tries) {
      const dx = Math.round(fx * w), lift = lv * LIFT;
      const x0 = p.x - w / 2 - dx, y0 = p.y - BUBBLE_H - lift + 4, y1 = p.y - lift - 9;
      const hit = placed.some((q) => x0 < q.x0 + w - 6 && x0 + w - 6 > q.x0 && y0 < q.y1 - 2 && y1 > q.y0 + 2);
      best = { dx, lift, x0, y0, y1 };
      if (!hit) break;
    }
    placed.push(best);
    if (best.dx || best.lift) placement.set(r.adid, { dx: best.dx, lift: best.lift });
  }
}

function drawAdMarkers() {
  adLayer.clearLayers();
  markers.clear();
  const seen = new Map();
  const bubbles = bubbleMode();
  const spots = [];
  for (const r of shown) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
    const key = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    let { lat, lon } = r;
    if (n) { // spread identical coordinates on a small spiral
      const ang = n * 2.4, rad = 0.0007 * Math.sqrt(n);
      lat += Math.sin(ang) * rad;
      lon += Math.cos(ang) * rad * 1.5;
    }
    spots.push({ r, lat, lon, ll: L.latLng(lat, lon) });
  }
  if (bubbles) layoutBubbles(spots); else placement.clear();
  for (const { r, lat, lon } of spots) {
    const m = L.marker([lat, lon], { icon: iconFor(r), title: bubbles ? undefined : r.title, keyboard: false, zIndexOffset: r.adid === selectedAdid ? 1000 : 0 }).addTo(adLayer);
    if (!bubbles) m.bindTooltip(`${r.title} – ${r.priceText || ''}`, { direction: 'top', offset: [0, -10] });
    m.on('click', () => {
      selectedAdid = r.adid;
      applySelection();
      const c = $(`card-${r.adid}`);
      if (!c) return;
      c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
    });
    m.on('mouseover', () => $(`card-${r.adid}`)?.classList.add('hl'));
    m.on('mouseout', () => $(`card-${r.adid}`)?.classList.remove('hl'));
    markers.set(r.adid, m);
  }
}

function applySelection() {
  document.querySelectorAll('.listing.sel').forEach((n) => n.classList.remove('sel'));
  if (selectedAdid) $(`card-${selectedAdid}`)?.classList.add('sel');
  for (const [adid, m] of markers) {
    const on = adid === selectedAdid;
    m.getElement()?.querySelector('.pin, .bubble')?.classList.toggle('sel', on);
    m.setZIndexOffset(on ? 1000 : 0);
  }
}

/** Show an ad on the map: fly to its pin (zoom 14) where the bubble opens, mark its card. */
function selectAd(adid, { fly = true } = {}) {
  const r = resultsById.get(adid);
  if (!r) return;
  selectedAdid = adid;
  if (filterQuery && r.query !== filterQuery) { filterQuery = null; renderResults(); }
  applySelection();
  const m = markers.get(adid);
  if (PHONE_MQ.matches) showPane(1);
  if (m && fly) map.flyTo(m.getLatLng(), 14, { duration: 0.8 });
}

map.on('zoomend', () => { drawAdMarkers(); applySelection(); });

// ---------- Merkliste (app-local) ----------
function updateMerkCount() {
  const b = $('merk-count');
  b.textContent = merk.size ? String(merk.size) : '';
  b.hidden = !merk.size;
}

async function loadMerk() {
  try {
    const list = await api('/api/merkliste');
    merk = new Map(list.map((e) => [e.adid, e]));
  } catch (e) { toast(`Merkliste konnte nicht geladen werden: ${e.message}`, true); }
  updateMerkCount();
}
async function loadContacts() {
  try { contacts = (await api('/api/contacts')) || {}; } catch (e) { toast(`Kontakte konnten nicht geladen werden: ${e.message}`, true); }
}

async function addMerk(ad, routeId) {
  if (routeId === undefined) { await flushSave(); routeId = state.routeId; }
  merk.set(ad.adid, await api(`/api/merkliste/${enc(ad.adid)}`, { method: 'PUT', body: { ad, routeId: routeId || null } }));
}

async function toggleMerk(adid) {
  const ad = adById(adid);
  if (!ad) return;
  try {
    if (merk.has(adid)) {
      await api(`/api/merkliste/${enc(adid)}`, { method: 'DELETE' });
      merk.delete(adid);
    } else {
      await addMerk(ad);
    }
  } catch (e) { toast(e.message, true); }
  onAdChanged(adid);
}

// ---------- contacts ----------
async function setStatus(adid, status) {
  try {
    contacts[adid] = await api(`/api/contacts/${enc(adid)}`, { method: 'PUT', body: { status } });
    if (status !== 'none' && !merk.has(adid)) { const ad = adById(adid); if (ad) await addMerk(ad); }
  } catch (e) { toast(e.message, true); }
  onAdChanged(adid);
}

async function addNote(adid, text) {
  try {
    const note = await api(`/api/contacts/${enc(adid)}/notes`, { method: 'POST', body: { text } });
    const c = contacts[adid] || (contacts[adid] = { status: 'none', notes: [], updatedAt: note.at });
    c.notes = [...(c.notes || []), note];
    return true;
  } catch (e) { toast(e.message, true); return false; } finally { onAdChanged(adid); }
}

async function delNote(adid, noteId) {
  try {
    await api(`/api/contacts/${enc(adid)}/notes/${enc(noteId)}`, { method: 'DELETE' });
    const c = contacts[adid];
    if (c) c.notes = c.notes.filter((n) => n.id !== noteId);
  } catch (e) { toast(e.message, true); }
  onAdChanged(adid);
}

// ---------- mail notifications (optional, see docs/API.md) ----------
async function loadMailNotifications() {
  try {
    const d = await api('/api/mail/notifications');
    const before = mailByAd;
    mailByAd = (d && d.byAd) || {};
    mailUnmatched = (d && d.unmatched) || [];
    for (const adid of new Set([...Object.keys(before), ...Object.keys(mailByAd)])) {
      if (unseenOf(adid) !== (before[adid]?.unseen || 0) || before[adid]?.lastAt !== mailByAd[adid]?.lastAt) onAdChanged(adid);
    }
  } catch { /* keep the last known state */ }
  renderMailSection();
}

async function loadMailStatus() {
  try { mailStatus = await api('/api/mail/status'); } catch { /* keep */ }
  if (mailStatus.configured) {
    if (!mailTimer) mailTimer = setInterval(loadMailNotifications, MAIL_POLL_MS);
    await loadMailNotifications();
  } else {
    clearInterval(mailTimer);
    mailTimer = null;
    mailByAd = {};
    mailUnmatched = [];
    renderMailSection();
  }
}

async function checkMailNow() {
  const btn = $('mail-check');
  if (btn) { btn.disabled = true; btn.textContent = 'Prüfe …'; }
  try { mailStatus = await api('/api/mail/check', { method: 'POST' }); await loadMailNotifications(); } catch (e) { toast(e.message, true); }
  renderMailSection();
}

async function markMailSeen(adid) {
  const n = mailByAd[adid];
  if (!n || !n.unseen) return;
  try { await api(`/api/mail/seen/${enc(adid)}`, { method: 'POST' }); } catch { return; }
  n.unseen = 0;
  onAdChanged(adid);
}

function renderMailSection() {
  const box = $('mail-section');
  const s = mailStatus;
  box.replaceChildren(el('h3', { class: 'group-title', text: 'E-Mail' }));
  if (!s.configured) {
    box.append(el('p', { class: 'small-note', text: window.TroedelApp
      ? 'E-Mail-Hinweise nur in der Desktop-Version – auf dem Handy liefert die Kleinanzeigen-App Push-Benachrichtigungen.'
      : 'Nicht eingerichtet. In .env einrichten – siehe README' }));
    return;
  }
  box.append(
    el('p', { class: 'small-note', text: `Eingerichtet: ${s.user || s.provider || ''} · ${s.lastCheck ? `zuletzt geprüft ${fmtDate(s.lastCheck)}` : 'noch nicht geprüft'}` }),
    ...(s.error ? [el('p', { class: 'error', text: `Fehler: ${s.error}` })] : []),
    el('button', { type: 'button', id: 'mail-check', class: 'btn btn-small btn-ghost', text: 'Jetzt prüfen', onclick: checkMailNow }));
  if (mailUnmatched.length) {
    box.append(el('p', { class: 'small-note', text: `${mailUnmatched.length} Nachricht${mailUnmatched.length > 1 ? 'en' : ''} ohne passende Anzeige:` }));
    const ul = el('ul', { class: 'mail-unmatched' });
    for (const u of mailUnmatched) {
      const link = safeUrl(u.link);
      ul.append(el('li', {}, el('span', { text: u.subject || '(ohne Betreff)' }), el('time', { datetime: u.at, text: fmtDate(u.at) }),
        link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: 'öffnen ↗' }) : null));
    }
    box.append(ul);
  }
}

// ---------- slide-overs ----------
const overlays = { nav: $('nav-drawer'), contact: $('contact-aside') };
let activeOverlay = null;
let lastFocus = null;
let contactAdid = null;
let currentTab = 'routes';

const focusables = (root) => [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
  .filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null);

function openOverlay(name) {
  if (activeOverlay === name) return;
  if (activeOverlay) closeOverlay(false);
  else lastFocus = document.activeElement;
  activeOverlay = name;
  overlays[name].classList.add('open');
  $('backdrop').classList.add('open');
  setTimeout(() => overlays[name].querySelector('.drawer-head .icon-btn')?.focus({ preventScroll: true }), 30);
}

function closeOverlay(restore = true) {
  if (!activeOverlay) return;
  overlays[activeOverlay].classList.remove('open');
  $('backdrop').classList.remove('open');
  activeOverlay = null;
  if (restore && lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

document.addEventListener('keydown', (e) => {
  if (!activeOverlay) return;
  if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); return; }
  if (e.key !== 'Tab') return;
  const f = focusables(overlays[activeOverlay]);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!overlays[activeOverlay].contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---------- nav drawer: routes + Merkliste ----------
let renamingId = null;
let confirmingId = null;

function setTab(tab) {
  currentTab = tab;
  for (const t of ['routes', 'merk', 'settings']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === tab));
    $(`panel-${t}`).hidden = t !== tab;
  }
  if (tab === 'routes') renderRoutes(); else if (tab === 'merk') renderMerk(); else renderSettings();
}

async function openNav(tab) {
  openOverlay('nav');
  setTab(tab);
  loadMailStatus();
}

async function renderRoutes() {
  const list = $('route-list');
  try {
    await flushSave();
    routesCache = await api('/api/routes');
  } catch (e) { toast(e.message, true); return; }
  list.replaceChildren();
  if (!routesCache.length) list.append(el('li', { class: 'empty-note', text: 'Noch keine gespeicherten Routen. Berechne eine Route – sie wird automatisch gespeichert.' }));
  for (const r of routesCache) {
    const li = el('li', { class: `route-item${r.id === state.routeId ? ' current' : ''}` });
    if (renamingId === r.id) {
      const input = el('input', { type: 'text', value: r.name, maxlength: '120', 'aria-label': 'Neuer Routenname' });
      input.value = r.name;
      const commit = () => renameRoute(r.id, input.value);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { e.stopPropagation(); renamingId = null; renderRoutes(); }
      });
      li.append(input,
        el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Speichern', onclick: commit }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Abbrechen', onclick: () => { renamingId = null; renderRoutes(); } }));
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      li.append(
        el('button', { type: 'button', class: 'route-open', 'aria-current': r.id === state.routeId ? 'true' : null, onclick: () => openRoute(r.id) },
          el('b', { text: r.name }), el('small', { text: `Geändert ${fmtDate(r.updatedAt)}` })),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Route „${r.name}“ umbenennen`, title: 'Umbenennen', text: '✎', onclick: () => { renamingId = r.id; confirmingId = null; renderRoutes(); } }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Route „${r.name}“ löschen`, title: 'Löschen', text: '🗑', onclick: () => { confirmingId = r.id; renamingId = null; renderRoutes(); } }));
      if (confirmingId === r.id) {
        li.append(el('div', { class: 'confirm', role: 'group', 'aria-label': 'Löschen bestätigen' },
          el('span', { text: `„${r.name}“ wirklich löschen?` }),
          el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Ja, löschen', onclick: () => deleteRoute(r.id) }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Abbrechen', onclick: () => { confirmingId = null; renderRoutes(); } })));
      }
    }
    list.append(li);
  }
}

async function renameRoute(id, name) {
  name = name.trim();
  if (!name) return;
  try {
    await api(`/api/routes/${enc(id)}`, { method: 'PUT', body: { name } });
    if (id === state.routeId) { state.routeName = name; state.nameAuto = false; $('route-name').value = name; }
  } catch (e) { toast(e.message, true); }
  renamingId = null;
  renderRoutes();
}

async function deleteRoute(id) {
  try {
    await api(`/api/routes/${enc(id)}`, { method: 'DELETE' });
    confirmingId = null;
    if (id === state.routeId) {
      dirty = false;
      const rest = (await api('/api/routes'))[0];
      if (rest) applyRoute(await api(`/api/routes/${enc(rest.id)}`)); else applyBlank();
    }
  } catch (e) { toast(e.message, true); }
  renderRoutes();
}

async function openRoute(id) {
  try {
    await flushSave();
    if (id !== state.routeId) applyRoute(await api(`/api/routes/${enc(id)}`));
    closeOverlay();
  } catch (e) { toast(e.message, true); }
}

async function newRoute() {
  try {
    await flushSave();
    const r = await api('/api/routes', { method: 'POST', body: { name: 'Neue Route' } });
    applyRoute(r);
    state.nameAuto = true;
    map.setView([51.16, 10.45], 6);
    closeOverlay();
    $('route-name').value = '';
    $(`stop-${state.stops[0].id}`)?.focus();
  } catch (e) { toast(e.message, true); }
}

function renderMerk() {
  const box = $('merk-list');
  box.replaceChildren();
  const entries = [...merk.values()].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  if (!entries.length) { box.append(el('p', { class: 'empty-note', text: 'Noch nichts gemerkt. Mit ♥ an einer Anzeige legst du sie hier ab.' })); return; }
  const names = new Map(routesCache.map((r) => [r.id, r.name]));
  if (state.routeId) names.set(state.routeId, state.routeName.trim() || autoName() || 'Aktuelle Route');
  const groups = new Map();
  for (const e of entries) {
    const key = e.routeId && names.has(e.routeId) ? e.routeId : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const order = [...groups.keys()].sort((a, b) => (a === state.routeId ? -1 : b === state.routeId ? 1 : a === '' ? 1 : b === '' ? -1 : names.get(a).localeCompare(names.get(b), 'de')));
  for (const key of order) {
    box.append(el('h3', { class: 'group-title', text: `${key ? names.get(key) : 'Ohne Route'}${key === state.routeId ? ' (aktuell)' : ''}` }));
    for (const e of groups.get(key)) {
      const ad = e.ad || {};
      const onMap = key === state.routeId && resultsById.has(e.adid);
      const link = safeUrl(ad.url);
      box.append(el('div', { class: 'merk-item' },
        thumbNode(ad),
        el('div', {},
          el('h4', { text: ad.title || e.adid }),
          priceNode(ad, 'price'),
          el('div', { class: 'meta', text: [ad.plz, ad.city].filter(Boolean).join(' ') }),
          el('div', { class: 'actions' },
            onMap ? el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'auf Karte zeigen', onclick: () => { closeOverlay(); selectAd(e.adid); } }) : null,
            link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Anzeige ↗' }) : null,
            el('span', { class: 'spacer' }),
            heartBtn(e.adid), chatChip(e.adid)))));
    }
  }
}

// ---------- contact aside ----------
let noteDrafts = {};

function openContact(adid) {
  const ad = adById(adid);
  if (!ad) return;
  contactAdid = adid;
  const body = $('contact-body');
  body.replaceChildren();
  const link = safeUrl(ad.url);

  const select = el('select', { id: 'contact-status' },
    ...Object.entries(STATUS).map(([k, v]) => el('option', { value: k, text: v.label })));
  select.addEventListener('change', () => setStatus(adid, select.value));
  const ta = el('textarea', { id: 'note-text', maxlength: '2000', placeholder: 'Notiz hinzufügen (z. B. Abholzeit, Adresse, Text aus dem Chat)', 'aria-label': 'Notiz hinzufügen' });
  ta.value = noteDrafts[adid] || '';
  ta.addEventListener('input', () => { noteDrafts[adid] = ta.value; });
  const submit = async () => {
    const text = ta.value.trim();
    if (!text) return;
    if (await addNote(adid, text)) { ta.value = ''; noteDrafts[adid] = ''; }
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });

  body.append(
    el('div', { class: 'c-summary' },
      thumbNode(ad),
      el('div', {}, el('h3', { text: ad.title }), priceNode(ad, 'price'),
        el('div', { class: 'meta', text: [ad.plz, ad.city].filter(Boolean).join(' ') }),
        el('div', { class: 'actions', id: 'aside-heart' }))),
    el('div', { id: 'aside-mail' }),
    el('div', { class: 'c-field' }, el('label', { for: 'contact-status', text: 'Status' }), select),
    el('div', { class: 'c-field' }, el('h3', { text: 'Notizen' }), el('ul', { class: 'notes', id: 'notes-list', 'aria-label': 'Notizen' }),
      ta, el('button', { type: 'button', class: 'btn btn-primary btn-small', id: 'note-add', text: 'Notiz speichern', onclick: submit })),
    el('div', { class: 'c-actions' },
      link ? el('a', { class: 'btn btn-primary', href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Verkäufer auf Kleinanzeigen schreiben' }) : null,
      el('a', { class: 'btn', href: INBOX_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Kleinanzeigen-Nachrichten öffnen' })),
    el('p', { class: 'c-note', text: 'Die App liest nicht in Kleinanzeigen mit – nur optionale E-Mail-Hinweise. Halte hier fest, was vereinbart ist.' }));
  syncAside();
  openOverlay('contact');
  markMailSeen(adid);
}

function syncAside() {
  const adid = contactAdid;
  const c = contacts[adid] || { status: 'none', notes: [] };
  const select = $('contact-status');
  if (!select) return;
  select.value = c.status;
  const mail = mailByAd[adid];
  const mbox = $('aside-mail');
  mbox.replaceChildren();
  if (mail) {
    const link = safeUrl(mail.link) || safeUrl(adById(adid)?.url);
    mbox.append(el('div', { class: 'mail-info' },
      el('p', {}, el('b', { text: 'Neue Nachricht per E-Mail: ' }), `${mail.lastSubject || 'Nachricht'} (${fmtDate(mail.lastAt)})`,
        mail.match === 'title' ? el('small', { text: ' (über den Titel zugeordnet)' }) : null),
      link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Auf Kleinanzeigen antworten' }) : null));
  }
  const hb = $('aside-heart');
  hb.replaceChildren(heartBtn(adid), el('span', { class: 'meta', text: merk.has(adid) ? 'auf der Merkliste' : 'nicht gemerkt' }));
  const list = $('notes-list');
  list.replaceChildren();
  const notes = c.notes || [];
  if (!notes.length) list.append(el('li', {}, el('span', { class: 'txt meta', text: 'Noch keine Notizen.' })));
  for (const n of notes) {
    list.append(el('li', {},
      el('span', { class: 'txt', text: n.text }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Notiz löschen', title: 'Notiz löschen', text: '×', onclick: () => delNote(adid, n.id) }),
      el('time', { datetime: n.at, text: fmtDate(n.at) })));
  }
}

// ---------- apply a route to the UI ----------
function applyRoute(r) {
  stopPolling();
  searchToken++;
  dirty = false;
  clearTimeout(saveTimer);
  state.routeId = r.id || null;
  state.routeName = r.name || '';
  state.nameAuto = !r.id;
  state.stops = (r.waypoints || []).map((w) => ({ id: nextId(), text: w.label || '', point: { lat: w.lat, lon: w.lon }, radiusKm: w.radiusKm || 0 }));
  while (state.stops.length < 2) state.stops.push(newStop());
  state.items = (r.items || []).map((i) => ({ id: nextId(), query: i.query, minPrice: i.minPrice ?? '', maxPrice: i.maxPrice ?? '' }));
  if (!state.items.length) state.items = [blankItem()];
  state.corridor = Math.min(50, Math.max(5, Math.round(r.corridorKm || 20)));
  state.mode = initialMode(r);
  state.route = r.geometry && r.geometry.coordinates ? { geometry: r.geometry, distanceKm: r.distanceKm, durationMin: r.durationMin } : null;
  state.searchedAt = r.searchedAt || null;
  setResults(r.results);
  filterQuery = null;
  selectedAdid = null;
  searchStatus = state.searchedAt || results.length ? 'done' : null;
  if (r.id) localStorage.setItem(LAST_ROUTE_KEY, r.id); else localStorage.removeItem(LAST_ROUTE_KEY);

  $('route-name').value = state.routeName;
  $('corridor').value = state.corridor;
  $('corridor-out').textContent = `${state.corridor} km`;
  showMsg($('route-error'), '');
  showMsg($('search-error'), '');
  $('blocked').hidden = true;
  finishSearch();
  const pw = $('progress-wrap');
  pw.hidden = !state.searchedAt;
  if (state.searchedAt) {
    $('progress').max = 1; $('progress').value = 1;
    $('progress-text').textContent = `Gespeicherte Ergebnisse vom ${fmtDate(state.searchedAt)} – ${results.length} Anzeigen.`;
  }
  renderStops();
  applyMode({ redraw: false });
  renderItems();
  drawRoute(true);
  renderResults();
}

function applyBlank() {
  applyRoute({ id: null, name: '', waypoints: [], items: [], corridorKm: 20, geometry: null, results: [], searchedAt: null });
  map.setView([51.16, 10.45], 6);
}

// ---------- old localStorage route -> saved route (once) ----------
async function migrateOld() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(OLD_STORE_KEY) || 'null'); } catch { /* corrupt */ }
  if (!raw) { localStorage.removeItem(OLD_STORE_KEY); return null; }
  const waypoints = (Array.isArray(raw.stops) ? raw.stops : [])
    .filter((s) => s && s.point && isFinite(s.point.lat) && isFinite(s.point.lon))
    .map((s) => ({ label: String(s.text || ''), lat: s.point.lat, lon: s.point.lon, radiusKm: 0 }));
  const items = (Array.isArray(raw.items) ? raw.items : []).filter((i) => i && String(i.query || '').trim())
    .map((i) => ({ query: String(i.query).trim(), minPrice: numOrNull(i.minPrice), maxPrice: numOrNull(i.maxPrice) }));
  const geo = raw.route && raw.route.geometry && raw.route.geometry.type === 'LineString' ? raw.route : null;
  if (!waypoints.length && !items.length) { localStorage.removeItem(OLD_STORE_KEY); return null; }
  const name = waypoints.length >= 2 ? `${shortLabel(waypoints[0].label)}–${shortLabel(waypoints[waypoints.length - 1].label)}` : 'Importierte Route';
  try {
    const r = await api('/api/routes', {
      method: 'POST',
      body: {
        name, waypoints, items, corridorKm: raw.corridor >= 5 && raw.corridor <= 50 ? raw.corridor : 20,
        geometry: geo ? geo.geometry : null, distanceKm: geo ? geo.distanceKm : null, durationMin: geo ? geo.durationMin : null,
      },
    });
    localStorage.removeItem(OLD_STORE_KEY);
    return r;
  } catch { return null; /* keep the old data and retry on next start */ }
}

// ---------- settings: theme, version, updates ----------
const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');
const themePref = () => localStorage.getItem(THEME_KEY) || 'system';

function applyTheme() {
  const pref = themePref();
  const dark = pref === 'dark' || (pref === 'system' && themeMQ.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b1a05' : '#1D4B00');
  for (const b of document.querySelectorAll('#theme-seg button')) b.setAttribute('aria-pressed', String(b.dataset.themePref === pref));
}

function initTheme() {
  for (const b of document.querySelectorAll('#theme-seg button')) {
    b.addEventListener('click', () => {
      if (b.dataset.themePref === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, b.dataset.themePref);
      applyTheme();
    });
  }
  themeMQ.addEventListener('change', applyTheme);
  $('check-update').addEventListener('click', async () => {
    const btn = $('check-update');
    btn.disabled = true;
    try {
      const res = await window.TroedelApp.checkForUpdates();
      $('update-note').textContent = typeof res === 'string' ? res : 'Suche nach Updates gestartet.';
    } catch (e) { $('update-note').textContent = `Update-Suche fehlgeschlagen: ${e.message}`; }
    btn.disabled = false;
  });
  applyTheme();
}

function renderSettings() {
  applyTheme();
  const native = window.TroedelApp;
  $('app-version').textContent = `App-Version: ${native?.version || APP_VERSION}${native ? ' (Android)' : ' (Browser)'}`;
  const can = typeof native?.checkForUpdates === 'function';
  $('check-update').hidden = !can;
  $('update-note').textContent = can ? '' : 'Nach Updates suchen: nur in der Android-App.';
}

// ---------- phone: Planung | Karte panes ----------
const panesEl = $('panes');
const paneIndex = () => (panesEl.scrollLeft > panesEl.clientWidth / 2 ? 1 : 0);

function syncTabs() {
  const max = panesEl.scrollWidth - panesEl.clientWidth;
  const p = max > 0 ? Math.min(1, Math.max(0, panesEl.scrollLeft / max)) : 0;
  $('tabbar').style.setProperty('--p', p.toFixed(3));
  const idx = p > 0.5 ? 1 : 0;
  for (const b of $('tabbar').querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', String(+b.dataset.pane === idx));
}

function showPane(i, smooth = true) {
  panesEl.scrollTo({ left: i * panesEl.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
}

/** Android back button: close the open drawer, else go from the map pane back to planning. true = handled. */
window.TroedelUi = {
  back() {
    if (activeOverlay) { closeOverlay(); return true; }
    if (PHONE_MQ.matches && paneIndex() === 1) { showPane(0); return true; }
    return false;
  },
};

function initPanes() {
  panesEl.addEventListener('scroll', () => requestAnimationFrame(syncTabs), { passive: true });
  for (const b of $('tabbar').querySelectorAll('[role=tab]')) b.addEventListener('click', () => showPane(+b.dataset.pane));
  const place = () => { map.zoomControl.setPosition(PHONE_MQ.matches ? 'topright' : 'topleft'); map.invalidateSize(); syncTabs(); };
  PHONE_MQ.addEventListener('change', place);
  window.addEventListener('resize', syncTabs);
  place();
}

// ---------- init ----------
async function init() {
  const savedLastId = localStorage.getItem(LAST_ROUTE_KEY);
  applyBlank();
  $('corridor').addEventListener('input', (e) => {
    state.corridor = +e.target.value;
    $('corridor-out').textContent = `${state.corridor} km`;
    persist();
  });
  $('add-stop').addEventListener('click', () => {
    if (state.stops.length >= MAX_STOPS) return;
    state.stops.push(newStop());
    renderStops();
    $(`stop-${state.stops[state.stops.length - 1].id}`)?.focus();
    persist();
  });
  $('add-item').addEventListener('click', () => {
    state.items.push(blankItem());
    renderItems();
    $(`q-${state.items[state.items.length - 1].id}`)?.focus();
    persist();
  });
  $('calc-route').addEventListener('click', calcRoute);
  $('search').addEventListener('click', startSearch);
  $('route-name').addEventListener('input', (e) => { state.routeName = e.target.value; state.nameAuto = false; persist(); });
  $('brand-btn').addEventListener('click', () => openNav('routes'));
  $('open-settings').addEventListener('click', () => openNav('settings'));
  $('tab-settings').addEventListener('click', () => setTab('settings'));
  for (const b of document.querySelectorAll('#mode-seg button')) b.addEventListener('click', () => setMode(b.dataset.mode));
  initTheme();
  initPanes();
  $('open-merk').addEventListener('click', () => openNav('merk'));
  $('nav-close').addEventListener('click', () => closeOverlay());
  $('contact-close').addEventListener('click', () => closeOverlay());
  $('backdrop').addEventListener('click', () => closeOverlay());
  $('tab-routes').addEventListener('click', () => setTab('routes'));
  $('tab-merk').addEventListener('click', () => setTab('merk'));
  $('new-route').addEventListener('click', newRoute);
  window.addEventListener('pagehide', () => { if (dirty) flushSave(); });

  await Promise.all([loadMerk(), loadContacts()]);
  loadMailStatus();
  try {
    const migrated = await migrateOld();
    const list = await api('/api/routes');
    routesCache = list;
    const lastId = migrated ? migrated.id : savedLastId;
    const pick = list.find((r) => r.id === lastId) || list[0];
    if (pick) applyRoute(migrated && migrated.id === pick.id ? migrated : await api(`/api/routes/${enc(pick.id)}`));
  } catch (e) { toast(`Routen konnten nicht geladen werden: ${e.message}`, true); }
  document.body.dataset.ready = '1';
}

init();
