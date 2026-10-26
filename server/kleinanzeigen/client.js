import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSearch, looksBlocked } from './parse.js';

const BASE = 'https://www.kleinanzeigen.de';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};
const CACHE_TTL = 15 * 60 * 1000;
const locFile = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'cache', 'location-ids.json');

export class BlockedError extends Error {
  constructor(msg = 'Kleinanzeigen hat die Anfrage blockiert (Captcha / 403 / 429)') {
    super(msg);
    this.name = 'BlockedError';
  }
}

export const stats = { requests: 0 };

// --- sequential global queue with jittered delay ---------------------------------------
let tail = Promise.resolve();
let lastRequestAt = 0;
let delayRange = [1200, 2000];
export function setDelay(min, max) {
  delayRange = [min, max];
}
function enqueue(fn) {
  const run = tail.then(async () => {
    const wait = lastRequestAt + delayRange[0] + Math.random() * (delayRange[1] - delayRange[0]) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  tail = run.catch(() => {});
  return run;
}

async function get(url) {
  return enqueue(async () => {
    stats.requests++;
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (res.status === 403 || res.status === 429) throw new BlockedError();
    if (!res.ok) throw new Error(`Kleinanzeigen antwortete mit HTTP ${res.status}`);
    return res;
  });
}

// --- caches --------------------------------------------------------------------------------
/** @type {Map<string,{at:number,items:any[]}>} */
const pageCache = new Map();
/** @type {Record<string,string|null>} */
let locIds = {};
try {
  if (existsSync(locFile)) locIds = JSON.parse(readFileSync(locFile, 'utf8'));
} catch {
  locIds = {};
}

/** Kleinanzeigen ignores the PLZ in the path; the numeric location id (`l…`) is what filters. */
export async function locationId(plz) {
  if (plz in locIds) return locIds[plz];
  const res = await get(`${BASE}/s-ort-empfehlungen.json?query=${encodeURIComponent(plz)}`);
  const json = await res.json();
  let id = null;
  for (const [k, v] of Object.entries(json)) {
    if (k !== '_0' && String(v).startsWith(plz)) id = k.slice(1);
  }
  if (!id) {
    const first = Object.keys(json).find((k) => k !== '_0');
    id = first ? first.slice(1) : null;
  }
  locIds[plz] = id;
  try {
    mkdirSync(dirname(locFile), { recursive: true });
    writeFileSync(locFile, JSON.stringify(locIds));
  } catch {
    /* cache is best effort */
  }
  return id;
}

export function slugify(keyword) {
  return keyword
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/-+/g, '-');
}

/** Builds /s-{PLZ}[/preis:min:max]/{keyword}/k0[l{id}]r{radius} */
export function buildSearchUrl({ plz, radius, query, minPrice, maxPrice, locId }) {
  const hasMin = minPrice != null && minPrice !== '';
  const hasMax = maxPrice != null && maxPrice !== '';
  const price = hasMin || hasMax ? `/preis:${hasMin ? Math.round(minPrice) : ''}:${hasMax ? Math.round(maxPrice) : ''}` : '';
  return `${BASE}/s-${plz}${price}/${encodeURIComponent(slugify(query))}/k0${locId ? `l${locId}` : ''}r${radius}`;
}

/**
 * Fetch the first result page for a query around a PLZ.
 * @throws {BlockedError}
 */
export async function searchPlz({ plz, radius, query, minPrice, maxPrice }) {
  const locId = await locationId(plz);
  const url = buildSearchUrl({ plz, radius, query, minPrice, maxPrice, locId });
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;

  const html = await (await get(url)).text();
  const items = parseSearch(html);
  if (items.length === 0 && looksBlocked(html)) throw new BlockedError();
  pageCache.set(url, { at: Date.now(), items });
  return items;
}
