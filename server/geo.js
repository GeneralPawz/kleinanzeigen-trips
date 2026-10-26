const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km between [lat,lon] points. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Distance from a point to a segment using an equirectangular projection around the segment.
 * Returns the distance in km and t in [0,1], the position of the closest point on the segment.
 */
export function pointToSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const k = Math.cos(rad((lat1 + lat2 + lat) / 3));
  const px = rad(lon - lon1) * k * R;
  const py = rad(lat - lat1) * R;
  const bx = rad(lon2 - lon1) * k * R;
  const by = rad(lat2 - lat1) * R;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return { km: Math.hypot(px - t * bx, py - t * by), t };
}
