const cache = new Map();
let tail = Promise.resolve();
let last = 0;

/**
 * Nominatim free-text geocoding: cached, at most 1 request/second.
 * @returns {Promise<{label:string,lat:number,lon:number}[]>}
 */
export async function geocode(q) {
  const key = q.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const run = tail.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=de&limit=5&accept-language=de&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': `Troedeltour/0.1 (+${process.env.CONTACT_EMAIL || 'no-contact'})` },
      });
      if (!res.ok) throw new Error(`Nominatim antwortete mit HTTP ${res.status}`);
      const json = await res.json();
      return json.map((r) => ({ label: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
    } finally {
      last = Date.now();
    }
  });
  tail = run.catch(() => {});
  const result = await run;
  cache.set(key, result);
  return result;
}
