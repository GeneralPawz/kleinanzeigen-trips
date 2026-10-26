# Map stack research: German road trip planner + Kleinanzeigen listings

Researched 2026-10-26. No app code yet.

## 1. Geocoding

**Nominatim public API** (`nominatim.openstreetmap.org`), policy from operations.osmfoundation.org:
- Hard limit: **max 1 request/second**. Bulk scripts running longer than a day are capped at 4 req/min.
- **User-Agent or Referer is mandatory** and must identify the app. Library defaults (`curl`, `python-requests`) are rejected.
- **Results must be cached** client-side. Repeated identical queries can get the client blocked.
- **No autocomplete** against the public API from the client. Systematic or grid lookups are prohibited.
- Policy may change without notice and access can be withdrawn.

**Recommendation:** do not use Nominatim for PLZ lookups. Use the offline PLZ table below. Use Nominatim only for free-text place names, one call per user action, cached in `localStorage`.

**Offline German PLZ centroids (recommended):**
- URL: `https://download.geonames.org/export/zip/DE.zip` (about 375 KB; GeoNames lists it as updated daily).
- License: **CC BY 4.0**. Attribution to GeoNames is required (a link to geonames.org is enough).
- Format: tab-delimited UTF-8, no header, 12 fields. Relevant ones: field 2 = postal code, field 3 = place name, field 10 = latitude, field 11 = longitude (WGS84). Field 12 = accuracy 1 to 6.
- Process once at build time into a small JSON (`plz -> [lat, lon, place]`), ship it as a static asset.
- OpenGeoDB is an alternative, but the search I ran could not confirm its license. Its SourceForge page says Public Domain. Use GeoNames for now.

## 2. Routing

**OSRM demo server** (`router.project-osrm.org`):
- URL format: `/route/v1/driving/{lon},{lat};{lon},{lat}?overview=full&geometries=geojson&steps=false`
- Returns GeoJSON `LineString` in `routes[0].geometry`, plus `distance` (m) and `duration` (s).
- `alternatives=true|n` is supported but not guaranteed.
- The docs page states **no usage policy or SLA** for the demo server. Treat it as dev-only. Expect throttling or outages.

**OpenRouteService (ORS), hosted API** (`api.openrouteservice.org`):
- Free key required. Standard plan: **2,000 directions/day, 40/min**. Commercial use is covered by Standard.
- Driving limit: 6,000 km max per directions request.
- Uses `driving-car` profile. Supports GeoJSON output (`/v2/directions/driving-car/geojson`, POST with `coordinates` as `[lon,lat]` pairs). I did not verify the exact request body against current docs; check before implementing.
- Key must stay server-side for anything public. A key in a static frontend is visible to anyone.

**FOSSGIS Valhalla** (`valhalla.openstreetmap.de` / `valhalla1.openstreetmap.de`): public demo instance with a full planet graph. **I found no published fair-use policy or rate limits**. Its HTTP API is on a separate subdomain. Unverified, so do not depend on it for production.

**Recommendation:** start with **OpenRouteService with a free key** for the prototype. Proxy the key through a tiny backend or serverless function. Use the OSRM demo only for local experiments. If volume grows, self-host OSRM (Docker, German extract from Geofabrik) so there is no key and no quota.

## 3. Map

**Leaflet 1.9.4** (released 2023-05-18, current stable as of this research). CDN with SRI, from leafletjs.com:
```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
```

**OSM tiles** (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`), policy from operations.osmfoundation.org:
- Attribution required and visible: `© OpenStreetMap contributors`, bottom-right, not hidden.
- No numeric quota, no SLA. Only load tiles for the current viewport plus modest look-ahead.
- **Prohibited:** prefetching or bulk download, offline "save area" features, headless panning bots, `Cache-Control: no-cache` by default.
- Browser default User-Agent is fine. HTTPS only.
- Heavy traffic can get the client blocked. For a real launch, use a commercial tile provider or self-host.

**Drawing the route and markers:**
```js
const map = L.map('map').setView([51.16, 10.45], 6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
const line = L.geoJSON(route.geometry, { style: { color: '#1D4B00', weight: 5 } }).addTo(map);
map.fitBounds(line.getBounds(), { padding: [30, 30] });
L.marker([lat, lon]).bindPopup(title).addTo(map);
```
Note: GeoJSON coordinates are `[lon, lat]`. `L.geoJSON` handles this. Manual `L.polyline` needs `[lat, lon]`.

## 4. Search points along the route

Recommended simple approach, no heavy dependency:
1. Flatten the route to a list of `[lat, lon]` points (from OSRM/ORS geometry).
2. **Sample** a search point every **N = 25 km** using cumulative haversine distance. Walk the polyline and emit a point each time the accumulated distance crosses a multiple of N.
3. For each sample point, query listings within **radius R = 15 km** (Kleinanzeigen-style "Umkreis" filter, or client-side haversine on the listings you have).
4. **Corridor filter:** keep a listing if its perpendicular distance to the polyline is at most the corridor width (e.g. 20 km). Compute point-to-segment distance using an equirectangular projection around the segment midpoint. At German latitudes this is accurate enough and avoids a dependency.
5. Dedupe listings by ID. Sort by distance from the route, then by distance along the route.

`@turf/turf` (`pointToLineDistance`, `along`, `length`) is a fine alternative if you want less custom geometry. It adds about 100 KB+ to the bundle, so only pull in `@turf/along`, `@turf/length`, `@turf/point-to-line-distance` if you go that way.

## 5. Kleinanzeigen brand theming

Read from the live site on 2026-10-26: `https://www.kleinanzeigen.de/` (inline `#1D4B00` plus linked `base.*.css`, `Layout.*.css`, `liberty.css`, which are Tailwind-style design tokens).

| Role | Hex | Source token (CSS) |
|---|---|---|
| Primary (dark green, header bar) | `#1D4B00` | `rgb(29 75 0)`, `bg-primary` |
| Interactive green (links, buttons) | `#326916` | `rgb(50 105 22)`, `border-/text-interactive` |
| Accent lime (highlight, badges) | `#B5E941` | `rgb(181 233 65)` |
| Light lime tint | `#E9F8C6` | `rgb(233 248 198)` |
| Page background (warm off-white) | `#F4F2EF` | `rgb(244 242 239)` |
| Text / near-black | `#0C0C0B` | `rgb(12 12 11)` |
| Border / divider | `#DDDBD5` | `#dddbd5` |
| Error | `#B30C0C` | `rgb(179 12 12)` |
| Purple (secondary UI, not core brand) | `#5A33AE` | `rgb(90 51 174)` |

- **Yellow accent: not found.** The live CSS has no yellow token. The closest accent is the lime `#B5E941`. If you want yellow, pick it deliberately rather than attributing it to Kleinanzeigen.
- **Font:** `"Helvetica Neue", Helvetica, Arial, sans-serif` (from `liberty.css` and `Layout.*.css`). The base stylesheet falls back to the system UI stack.

## Open items

- Confirm the ORS driving-car GeoJSON request body against current docs before coding.
- Check Kleinanzeigen terms of use before any scraping. This research did not look at listing data sources or an official API.
- FOSSGIS Valhalla usage policy: unverified.
