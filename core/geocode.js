import { createQueue } from './queue.js';

/**
 * Nominatim free-text geocoding: cached, at most 1 request/second.
 * @param {{ http: {getJson:(url:string,headers?:object)=>Promise<any>}, contactEmail?: string }} opts
 * @returns {(q: string) => Promise<{label:string,lat:number,lon:number}[]>}
 */
export function createGeocoder({ http, contactEmail }) {
  const cache = new Map();
  const queue = createQueue([1100, 1100]);
  return async function geocode(q) {
    const key = q.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const result = await queue.enqueue(async () => {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=de&limit=5&accept-language=de&q=${encodeURIComponent(q)}`;
      let json;
      try {
        json = await http.getJson(url, { 'User-Agent': `Troedeltour/0.1 (+${contactEmail || 'no-contact'})` });
      } catch (e) {
        throw e.status ? new Error(`Nominatim antwortete mit HTTP ${e.status}`) : e;
      }
      return json.map((r) => ({ label: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
    });
    cache.set(key, result);
    return result;
  };
}
