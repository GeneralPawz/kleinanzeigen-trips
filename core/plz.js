/**
 * PLZ lookups over an injected table (the caller loads data/plz-de.json however it likes).
 * @param {{plz: Record<string,[number,number]>, cities: Record<string,[number,number]>}} table
 */
export function createPlz(table = { plz: {}, cities: {} }) {
  const cities = table.cities || {};
  const entries = Object.entries(table.plz || {});
  return {
    /** @returns {[number,number]|null} [lat, lon] for a PLZ, falling back to a city name. */
    lookup(plz, city) {
      if (plz && table.plz[plz]) return table.plz[plz];
      if (city) {
        const c = city.toLowerCase();
        return cities[c] || cities[c.split(/[\s,(-]/)[0]] || null;
      }
      return null;
    },
    /** Nearest PLZ centroid by simple scan (equirectangular metric). */
    nearest(lat, lon) {
      const k = Math.cos((lat * Math.PI) / 180);
      let best = null;
      let bestD = Infinity;
      for (const [plz, [la, lo]] of entries) {
        const dy = la - lat;
        const dx = (lo - lon) * k;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { plz, lat: la, lon: lo };
        }
      }
      return best;
    },
  };
}
