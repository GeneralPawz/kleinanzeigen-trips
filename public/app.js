// Trödeltour frontend – plain ES module, talks to the backend per docs/API.md
const L = window.L;

const $ = (id) => document.getElementById(id);
const PALETTE = ['#326916', '#E8590C', '#1C7ED6', '#B5E941', '#9C36B5', '#C2255C', '#0B7285', '#F08C00', '#1D4B00', '#5C940D'];
const STORE_KEY = 'troedeltour.v1';
const DEBOUNCE_MS = 650;
const POLL_MS = 1500;

let uid = 0;
const nextId = () => `n${++uid}`;

/** @type {{stops: {id:string,text:string,point:{lat:number,lon:number}|null}[], items: {id:string,query:string,minPrice:string,maxPrice:string}[], corridor:number, route: any}} */
const state = { stops: [], items: [], corridor: 20, route: null };
let results = [];
let filterQuery = null;
let searchStatus = null;
let pollTimer = null;
let loggedIn = false;

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
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

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const fmtKm = (n) => (Math.round(n * 10) / 10).toLocaleString('de-DE');
function fmtDuration(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function showMsg(node, msg) {
  node.textContent = msg || '';
  node.hidden = !msg;
}

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      stops: state.stops, items: state.items, corridor: state.corridor, route: state.route,
    }));
  } catch { /* storage unavailable */ }
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw) return;
    if (Array.isArray(raw.stops) && raw.stops.length >= 2) {
      state.stops = raw.stops.map((s) => ({ id: nextId(), text: String(s.text || ''), point: s.point && isFinite(s.point.lat) ? s.point : null }));
    }
    if (Array.isArray(raw.items) && raw.items.length) {
      state.items = raw.items.map((i) => ({ id: nextId(), query: String(i.query || ''), minPrice: i.minPrice ?? '', maxPrice: i.maxPrice ?? '' }));
    }
    if (raw.corridor >= 5 && raw.corridor <= 50) state.corridor = raw.corridor;
    if (raw.route && raw.route.geometry && raw.route.geometry.coordinates) state.route = raw.route;
  } catch { /* corrupt storage */ }
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

function drawStops() {
  stopLayer.clearLayers();
  const pts = state.stops.map((s, i) => ({ s, i })).filter((x) => x.s.point);
  pts.forEach(({ s, i }) => {
    const last = i === state.stops.length - 1;
    const kind = i === 0 ? 'start' : last ? 'end' : 'via';
    const label = i === 0 ? 'S' : last ? 'Z' : String(i);
    const title = i === 0 ? 'Start' : last ? 'Ziel' : `Zwischenstopp ${i}`;
    L.marker([s.point.lat, s.point.lon], { icon: endIcon(kind, label), title: `${title}: ${s.text}`, zIndexOffset: 500 }).addTo(stopLayer);
  });
}

function drawRoute(fit) {
  routeLayer.clearLayers();
  routeLine = null;
  if (!state.route) return;
  routeLine = L.geoJSON(state.route.geometry, { style: { color: '#1D4B00', weight: 5, opacity: .85 } }).addTo(routeLayer);
  if (fit) map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
  $('route-info').textContent = `${fmtKm(state.route.distanceKm)} km · ${fmtDuration(state.route.durationMin)} Fahrzeit`;
}

// ---------- route inputs ----------
const suggestState = { timers: new Map(), seq: new Map() };

function newStop(text = '') { return { id: nextId(), text, point: null }; }

function renderStops() {
  const list = $('stops');
  list.replaceChildren();
  const n = state.stops.length;
  state.stops.forEach((stop, i) => {
    const role = i === 0 ? 'Start' : i === n - 1 ? 'Ziel' : `Zwischenstopp ${i}`;
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
      save();
      scheduleSuggest(stop, input, sug);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') sug.hidden = true; });
    input.addEventListener('blur', () => setTimeout(() => { if (!sug.contains(document.activeElement)) sug.hidden = true; }, 150));

    const up = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `${role} nach oben`, title: 'Nach oben', text: '↑', disabled: i === 0, onclick: () => moveStop(i, -1) });
    const down = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `${role} nach unten`, title: 'Nach unten', text: '↓', disabled: i === n - 1, onclick: () => moveStop(i, 1) });
    const rm = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `${role} entfernen`, title: 'Entfernen', text: '×', disabled: n <= 2, onclick: () => removeStop(i) });
    list.append(el('li', { class: 'stop' },
      el('label', { for: inputId, text: role }),
      el('div', { class: 'stop-line' }, el('div', { class: 'field' }, input, sug), up, down, rm)));
  });
  drawStops();
}

function moveStop(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.stops.length) return;
  [state.stops[i], state.stops[j]] = [state.stops[j], state.stops[i]];
  invalidateRoute();
  renderStops();
  save();
}
function removeStop(i) {
  if (state.stops.length <= 2) return;
  state.stops.splice(i, 1);
  invalidateRoute();
  renderStops();
  save();
}
function invalidateRoute() { /* keep drawn route until recalculated; info stays */ }

function scheduleSuggest(stop, input, sug) {
  clearTimeout(suggestState.timers.get(stop.id));
  const q = input.value.trim();
  if (q.length < 3) { sug.hidden = true; return; }
  suggestState.timers.set(stop.id, setTimeout(async () => {
    const seq = (suggestState.seq.get(stop.id) || 0) + 1;
    suggestState.seq.set(stop.id, seq);
    try {
      const hits = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
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
  save();
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
      const hits = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!hits.length) throw new Error(`Ort nicht gefunden: „${q}“`);
      stop.point = { lat: hits[0].lat, lon: hits[0].lon };
      stop.text = hits[0].label;
    }
    renderStops();
    const waypoints = state.stops.map((s) => ({ lat: s.point.lat, lon: s.point.lon }));
    state.route = await api('/api/route', { method: 'POST', body: { waypoints } });
    clearResults();
    drawRoute(true);
    save();
  } catch (e) {
    showMsg(err, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Route berechnen';
  }
}

// ---------- items ----------
function renderItems() {
  const list = $('items');
  list.replaceChildren();
  state.items.forEach((item, i) => {
    const q = el('input', { type: 'text', id: `q-${item.id}`, value: item.query, placeholder: 'z. B. Fahrrad', autocomplete: 'off' });
    const min = el('input', { type: 'number', id: `min-${item.id}`, value: item.minPrice, min: '0', inputmode: 'numeric', placeholder: '€' });
    const max = el('input', { type: 'number', id: `max-${item.id}`, value: item.maxPrice, min: '0', inputmode: 'numeric', placeholder: '€' });
    q.value = item.query; min.value = item.minPrice; max.value = item.maxPrice;
    q.addEventListener('input', () => { item.query = q.value; save(); });
    min.addEventListener('input', () => { item.minPrice = min.value; save(); });
    max.addEventListener('input', () => { item.maxPrice = max.value; save(); });
    const rm = el('button', { type: 'button', class: 'icon-btn remove', 'aria-label': `Suchbegriff ${i + 1} entfernen`, title: 'Entfernen', text: '×', disabled: state.items.length <= 1, onclick: () => { state.items.splice(i, 1); renderItems(); save(); } });
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
  results = [];
  filterQuery = null;
  searchStatus = null;
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
  clearResults();
  const btn = $('search');
  btn.disabled = true;
  btn.textContent = 'Suche läuft…';
  $('progress-wrap').hidden = false;
  $('progress').removeAttribute('value');
  $('progress-text').textContent = 'Suche wird gestartet…';
  try {
    const { jobId } = await api('/api/search', { method: 'POST', body: { geometry: state.route.geometry, corridorKm: state.corridor, items } });
    poll(jobId);
  } catch (e) {
    showMsg(err, e.message);
    finishSearch();
  }
}

function finishSearch() {
  const btn = $('search');
  btn.disabled = false;
  btn.textContent = 'Entlang der Route suchen';
}

async function poll(jobId) {
  try {
    const job = await api(`/api/search/${encodeURIComponent(jobId)}`);
    searchStatus = job.status;
    const { done = 0, total = 0 } = job.progress || {};
    const bar = $('progress');
    if (total > 0) { bar.max = total; bar.value = done; } else bar.removeAttribute('value');
    $('progress-text').textContent = job.status === 'running'
      ? `Suche ${done} von ${total || '?'} Abschnitten…`
      : job.status === 'done' ? `Fertig – ${job.results.length} Anzeigen gefunden.` : `${job.results.length} Anzeigen gefunden.`;
    if (Array.isArray(job.results) && job.results.length !== results.length) {
      results = job.results;
      renderResults();
    } else if (Array.isArray(job.results)) {
      results = job.results;
    }
    if (job.status === 'running') {
      pollTimer = setTimeout(() => poll(jobId), POLL_MS);
      return;
    }
    if (job.status === 'blocked') $('blocked').hidden = false;
    if (job.status === 'error') showMsg($('search-error'), job.error || 'Die Suche ist fehlgeschlagen.');
    if (job.status === 'done') bar.value = bar.max;
    finishSearch();
  } catch (e) {
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

  const shown = results.filter((r) => !filterQuery || r.query === filterQuery).sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
  $('result-count').textContent = results.length ? `(${shown.length})` : '';
  const list = $('results');
  list.replaceChildren();
  if (!shown.length) {
    list.append(el('li', { class: 'empty-note', text: searchStatus === 'running' ? 'Noch keine Treffer …' : 'Keine Anzeigen im Korridor gefunden.' }));
  }
  for (const r of shown) list.append(card(r));
  drawAdMarkers(shown);
}

function card(r) {
  const color = colorFor(r.query);
  const img = safeUrl(r.image)
    ? el('img', { class: 'thumb', src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
    : el('div', { class: 'thumb empty', text: 'Kein Bild' });
  img.addEventListener?.('error', () => img.replaceWith(el('div', { class: 'thumb empty', text: 'Kein Bild' })));
  const price = el('div', { class: 'price' }, r.priceText || (r.price != null ? `${r.price} €` : 'Preis auf Anfrage'));
  if (r.vb && !/VB/i.test(r.priceText || '')) price.append(el('span', { class: 'vb', text: 'VB' }));
  else if (r.vb) {
    price.textContent = (r.priceText || '').replace(/\s*VB\s*$/i, '');
    price.append(el('span', { class: 'vb', text: 'VB' }));
  }
  const link = safeUrl(r.url);
  const actions = el('div', { class: 'actions' },
    link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Anzeige öffnen', el('span', { class: 'sr-only', style: 'position:absolute;left:-9999px', text: ` – ${r.title}` })) : null);
  if (loggedIn) {
    const b = el('button', { type: 'button', class: 'btn btn-small', text: 'Merken', onclick: () => watch(r, b) });
    actions.append(b);
  }
  const li = el('li', { class: 'listing', id: `card-${r.adid}`, style: `--c:${color}` },
    img,
    el('div', {},
      el('div', { class: 'tag', text: r.query }),
      el('h3', { text: r.title }),
      price,
      el('div', { class: 'meta', text: `${[r.plz, r.city].filter(Boolean).join(' ')}` }),
      el('div', { class: 'meta', text: `km ${Math.round(r.kmAlongRoute)} der Route · ${fmtKm(r.distanceToRouteKm)} km Umweg` }),
      r.date ? el('div', { class: 'meta', text: r.date }) : null,
      actions));
  li.addEventListener('mouseenter', () => highlight(r.adid, true));
  li.addEventListener('mouseleave', () => highlight(r.adid, false));
  li.addEventListener('focusin', () => highlight(r.adid, true));
  li.addEventListener('focusout', () => highlight(r.adid, false));
  return li;
}

async function watch(r, btn) {
  btn.disabled = true;
  try {
    const res = await api(`/api/watchlist/${encodeURIComponent(r.adid)}`, { method: 'POST' });
    if (res.ok) { btn.textContent = 'Gemerkt ✓'; return; }
    const u = safeUrl(res.fallbackUrl);
    if (u) window.open(u, '_blank', 'noopener');
    btn.textContent = 'Auf Kleinanzeigen merken';
    btn.disabled = false;
  } catch (e) {
    btn.textContent = 'Fehler – erneut';
    btn.disabled = false;
  }
}

// ---------- ad markers ----------
function highlight(adid, on) {
  const m = markers.get(adid);
  if (!m) return;
  const node = m.getElement()?.querySelector('.pin');
  if (node) node.classList.toggle('hl', on);
  m.setZIndexOffset(on ? 1000 : 0);
  const c = document.getElementById(`card-${adid}`);
  if (c && !on) c.classList.remove('hl');
}

function drawAdMarkers(shown) {
  adLayer.clearLayers();
  markers.clear();
  const seen = new Map();
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
    const icon = L.divIcon({ className: '', html: `<div class="pin" style="--c:${colorFor(r.query)}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker([lat, lon], { icon, title: r.title, keyboard: false }).addTo(adLayer);
    m.bindTooltip(`${r.title} – ${r.priceText || ''}`, { direction: 'top', offset: [0, -10] });
    m.on('click', () => {
      const c = document.getElementById(`card-${r.adid}`);
      if (!c) return;
      c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
    });
    m.on('mouseover', () => document.getElementById(`card-${r.adid}`)?.classList.add('hl'));
    m.on('mouseout', () => document.getElementById(`card-${r.adid}`)?.classList.remove('hl'));
    markers.set(r.adid, m);
  }
}

// ---------- account ----------
async function renderAccount() {
  const box = $('account');
  let st;
  try { st = await api('/api/auth/status'); } catch { box.replaceChildren(); return; }
  loggedIn = !!st.loggedIn;
  box.replaceChildren();
  if (!st.available) {
    box.append(el('span', { class: 'hint', title: 'Anmeldung nicht verfügbar (Playwright ist auf dem Server nicht installiert).', tabindex: '0', text: 'ⓘ Anmeldung nicht verfügbar' }));
  } else if (st.loggedIn) {
    box.append(
      el('span', { class: 'user', text: `Angemeldet als ${st.username || 'Nutzer'}` }),
      el('button', {
        type: 'button', class: 'btn outline', text: 'Abmelden',
        onclick: async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ } renderAccount(); },
      }));
  } else {
    const msg = el('span', { role: 'status' });
    const btn = el('button', { type: 'button', class: 'btn', text: 'Mit Kleinanzeigen verbinden' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = 'Bitte im geöffneten Browserfenster anmelden…';
      try { await api('/api/auth/login', { method: 'POST' }); } catch (e) { msg.textContent = e.message; btn.disabled = false; return; }
      await renderAccount();
    });
    box.append(msg, btn);
  }
  if (results.length) renderResults();
}

// ---------- init ----------
function init() {
  load();
  if (state.stops.length < 2) state.stops = [newStop(), newStop()];
  if (!state.items.length) state.items = [{ id: nextId(), query: '', minPrice: '', maxPrice: '' }];
  renderStops();
  renderItems();
  $('corridor').value = state.corridor;
  $('corridor-out').textContent = `${state.corridor} km`;
  $('corridor').addEventListener('input', (e) => {
    state.corridor = +e.target.value;
    $('corridor-out').textContent = `${state.corridor} km`;
    save();
  });
  $('add-stop').addEventListener('click', () => {
    state.stops.splice(state.stops.length - 1, 0, newStop());
    if (state.stops.length > 10) state.stops.splice(state.stops.length - 2, 1);
    renderStops();
    document.getElementById(`stop-${state.stops[state.stops.length - 2].id}`)?.focus();
    save();
  });
  $('add-item').addEventListener('click', () => {
    state.items.push({ id: nextId(), query: '', minPrice: '', maxPrice: '' });
    renderItems();
    document.getElementById(`q-${state.items[state.items.length - 1].id}`)?.focus();
    save();
  });
  $('calc-route').addEventListener('click', calcRoute);
  $('search').addEventListener('click', startSearch);
  drawRoute(true);
  renderAccount();
}

init();
