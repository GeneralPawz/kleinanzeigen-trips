# Trödeltour — API contract (backend ⇄ frontend)

Stack: Node 22, Express (ESM, plain JS, JSDoc types), static frontend in `public/` served by Express. No build step.
Run: `npm install && npm start` → http://localhost:3000. Port via `PORT`. Optional env in `.env`: `ORS_API_KEY` (else OSRM demo), `CONTACT_EMAIL` (Nominatim UA).

All JSON. Errors: `{ "error": "message" }` with 4xx/5xx.

## Geocoding
`GET /api/geocode?q=Hamburg` → `[{ "label": "Hamburg, Deutschland", "lat": 53.55, "lon": 9.99 }]` (max 5, countrycodes=de, Nominatim, cached, ≤1 req/s)

## Route
`POST /api/route` `{ "waypoints": [{ "lat": 53.55, "lon": 9.99 }, ...] }` (2–10 points, in order)
→ `{ "geometry": GeoJSON LineString ([lon,lat]), "distanceKm": 612.3, "durationMin": 380 }`

## Search along route (async job, frontend polls)
`POST /api/search`
```json
{ "geometry": <LineString>, "corridorKm": 20,
  "items": [{ "query": "Fahrrad", "minPrice": 50, "maxPrice": 300 }] }
```
→ `{ "jobId": "abc123" }`

`GET /api/search/:jobId` →
```json
{ "status": "running|done|error|blocked", "progress": { "done": 12, "total": 40 }, "error": null,
  "results": [{
    "adid": "3012345678", "query": "Fahrrad", "title": "...", "priceText": "600 € VB", "price": 600, "vb": true,
    "url": "https://www.kleinanzeigen.de/s-anzeige/...", "image": "https://img.kleinanzeigen.de/...",
    "plz": "74575", "city": "Schrozberg", "lat": 49.35, "lon": 9.98, "date": "Heute, 10:30",
    "distanceToRouteKm": 4.2, "kmAlongRoute": 233.0 }] }
```
Results are deduped by adid, filtered to `distanceToRouteKm <= corridorKm`, sorted by `kmAlongRoute`, and appear incrementally while running. `blocked` = Kleinanzeigen showed a captcha or 403/429; stop and keep the partial results.

## Kleinanzeigen account (optional)
- `GET /api/auth/status` → `{ "loggedIn": false, "username": null, "available": true }` (`available` false if Playwright is not installed)
- `POST /api/auth/login` → opens a visible Chromium window (persistent profile in `.sessions/`) on the Kleinanzeigen login page. The user signs in there themselves; the app never sees the password. Resolves `{ loggedIn, username }` once logged in (timeout 5 min).
- `POST /api/auth/logout` → clears the profile.
- `POST /api/watchlist/:adid` → adds the ad to the user's Merkliste using the session (best effort) → `{ "ok": true }` or `{ "ok": false, "fallbackUrl": "<ad url>" }`.
