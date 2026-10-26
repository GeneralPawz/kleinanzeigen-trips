import { parseSearch, looksBlocked } from './parse.js';
import { createQueue } from './queue.js';

export const BASE = 'https://www.kleinanzeigen.de';
export const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};
const CACHE_TTL = 15 * 60 * 1000;

export class BlockedError extends Error {
  constructor(msg = 'Kleinanzeigen hat die Anfrage blockiert (Captcha / 403 / 429)') {
    super(msg);
    this.name = 'BlockedError';
  }
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

/** Picks the numeric location id (`l…`) out of an s-ort-empfehlungen.json answer for a PLZ. */
export function pickLocationId(json, plz) {
  let id = null;
  for (const [k, v] of Object.entries(json)) {
    if (k !== '_0' && String(v).startsWith(plz)) id = k.slice(1);
  }
  if (!id) {
    const first = Object.keys(json).find((k) => k !== '_0');
    id = first ? first.slice(1) : null;
  }
  return id;
}

/**
 * Kleinanzeigen client: global sequential queue with jittered delay, page cache, location-id cache.
 * `http.getText(url, headers)` / `http.getJson(url, headers)` must reject with an Error carrying
 * `status` (number) for non-2xx answers.
 * @param {{ http: {getText:(url:string,headers?:object)=>Promise<string>, getJson:(url:string,headers?:object)=>Promise<any>},
 *   locIds?: Record<string,string|null>, onLocIds?: (ids: Record<string,string|null>) => void,
 *   delay?: [number,number] }} opts
 */
export function createKleinanzeigenClient({ http, locIds = {}, onLocIds, delay = [1200, 2000] }) {
  const queue = createQueue(delay);
  const stats = { requests: 0 };
  /** @type {Map<string,{at:number,items:any[]}>} */
  const pageCache = new Map();

  const get = (kind, url) =>
    queue.enqueue(async () => {
      stats.requests++;
      try {
        return await http[kind](url, HEADERS);
      } catch (e) {
        if (e.status === 403 || e.status === 429) throw new BlockedError();
        if (e.status) throw new Error(`Kleinanzeigen antwortete mit HTTP ${e.status}`);
        throw e;
      }
    });

  /** Kleinanzeigen ignores the PLZ in the path; the numeric location id (`l…`) is what filters. */
  async function locationId(plz) {
    if (plz in locIds) return locIds[plz];
    const json = await get('getJson', `${BASE}/s-ort-empfehlungen.json?query=${encodeURIComponent(plz)}`);
    const id = pickLocationId(json, plz);
    locIds[plz] = id;
    try {
      onLocIds?.(locIds);
    } catch {
      /* cache is best effort */
    }
    return id;
  }

  /**
   * Fetch the first result page for a query around a PLZ.
   * @throws {BlockedError}
   */
  async function searchPlz({ plz, radius, query, minPrice, maxPrice }) {
    const locId = await locationId(plz);
    const url = buildSearchUrl({ plz, radius, query, minPrice, maxPrice, locId });
    const hit = pageCache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;

    const html = await get('getText', url);
    const items = parseSearch(html);
    if (items.length === 0 && looksBlocked(html)) throw new BlockedError();
    pageCache.set(url, { at: Date.now(), items });
    return items;
  }

  return { searchPlz, locationId, stats, setDelay: queue.setDelay };
}
