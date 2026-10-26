const round1 = (n) => Math.round(n * 10) / 10;
const httpError = (name, e) => (e.status ? new Error(`${name} antwortete mit HTTP ${e.status}`) : e);

/**
 * Driving route through waypoints. Uses OpenRouteService when `orsKey` is set (needs `http.postJson`),
 * else the OSRM demo.
 * @param {{ http: {getJson:Function, postJson?:Function}, orsKey?: string, contactEmail?: string }} opts
 * @returns {(waypoints: {lat:number,lon:number}[]) => Promise<{geometry:{type:'LineString',coordinates:[number,number][]},distanceKm:number,durationMin:number}>}
 */
export function createRouter({ http, orsKey, contactEmail }) {
  const ua = { 'User-Agent': `Troedeltour/0.1 (+${contactEmail || 'no-contact'})` };

  async function osrmRoute(wps) {
    const coords = wps.map((w) => `${w.lon},${w.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    let json;
    try {
      json = await http.getJson(url, ua);
    } catch (e) {
      throw httpError('OSRM', e);
    }
    const r = json.routes?.[0];
    if (json.code !== 'Ok' || !r) throw new Error(`Keine Route gefunden (${json.code || 'unbekannt'})`);
    return { geometry: r.geometry, distanceKm: round1(r.distance / 1000), durationMin: Math.round(r.duration / 60) };
  }

  async function orsRoute(wps) {
    let json;
    try {
      json = await http.postJson(
        'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
        { coordinates: wps.map((w) => [w.lon, w.lat]) },
        { Authorization: orsKey, ...ua },
      );
    } catch (e) {
      throw httpError('OpenRouteService', e);
    }
    const f = json.features?.[0];
    if (!f) throw new Error('Keine Route gefunden');
    const s = f.properties.summary;
    return { geometry: f.geometry, distanceKm: round1(s.distance / 1000), durationMin: Math.round(s.duration / 60) };
  }

  return (waypoints) => (orsKey && http.postJson ? orsRoute(waypoints) : osrmRoute(waypoints));
}
