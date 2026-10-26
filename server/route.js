/**
 * Driving route through waypoints. Uses OpenRouteService when ORS_API_KEY is set, else the OSRM demo.
 * @param {{lat:number,lon:number}[]} waypoints
 * @returns {Promise<{geometry:{type:'LineString',coordinates:[number,number][]},distanceKm:number,durationMin:number}>}
 */
export async function getRoute(waypoints) {
  const key = process.env.ORS_API_KEY;
  return key ? orsRoute(waypoints, key) : osrmRoute(waypoints);
}

async function osrmRoute(wps) {
  const coords = wps.map((w) => `${w.lon},${w.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok) throw new Error(`OSRM antwortete mit HTTP ${res.status}`);
  const json = await res.json();
  const r = json.routes?.[0];
  if (json.code !== 'Ok' || !r) throw new Error(`Keine Route gefunden (${json.code || 'unbekannt'})`);
  return { geometry: r.geometry, distanceKm: round1(r.distance / 1000), durationMin: Math.round(r.duration / 60) };
}

async function orsRoute(wps, key) {
  const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json', 'User-Agent': userAgent() },
    body: JSON.stringify({ coordinates: wps.map((w) => [w.lon, w.lat]) }),
  });
  if (!res.ok) throw new Error(`OpenRouteService antwortete mit HTTP ${res.status}`);
  const json = await res.json();
  const f = json.features?.[0];
  if (!f) throw new Error('Keine Route gefunden');
  const s = f.properties.summary;
  return { geometry: f.geometry, distanceKm: round1(s.distance / 1000), durationMin: Math.round(s.duration / 60) };
}

const round1 = (n) => Math.round(n * 10) / 10;
const userAgent = () => `Troedeltour/0.1 (+${process.env.CONTACT_EMAIL || 'no-contact'})`;
