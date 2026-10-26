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
  "items": [{ "query": "Fahrrad", "minPrice": 50, "maxPrice": 300 }],
  "stops": [{ "lat": 51.54, "lon": 9.93, "label": "Göttingen", "radiusKm": 10 }] }
```
`stops` is optional (max 10). `radiusKm` ∈ 0 (off), 5, 10, 20, 30, 50, otherwise 400; stops with 0 are ignored; missing `label` becomes "Stopp N".
Besides the corridor samples (every ~25 km, radius 30), the nearest PLZ of each stop is searched with the smallest Kleinanzeigen radius step ≥ `radiusKm`; identical (PLZ, radius) searches run once. A result is kept if it is within `corridorKm` of the route **or** within `radiusKm` (haversine) of a stop.
→ `{ "jobId": "abc123" }`

`GET /api/search/:jobId` →
```json
{ "status": "running|done|error|blocked", "progress": { "done": 12, "total": 40 }, "error": null,
  "results": [{
    "adid": "3012345678", "query": "Fahrrad", "title": "...", "priceText": "600 € VB", "price": 600, "vb": true,
    "url": "https://www.kleinanzeigen.de/s-anzeige/...", "image": "https://img.kleinanzeigen.de/...",
    "plz": "74575", "city": "Schrozberg", "lat": 49.35, "lon": 9.98, "date": "Heute, 10:30",
    "distanceToRouteKm": 4.2, "kmAlongRoute": 233.0,
    "nearStop": "Göttingen", "distanceToStopKm": 7.9 }] }
```
`nearStop` / `distanceToStopKm` (km, 1 decimal): label and distance of the nearest stop whose radius contains the ad, else both `null`. Results are deduped by adid, kept if `distanceToRouteKm <= corridorKm` or `nearStop != null`, sorted by `kmAlongRoute`, and appear incrementally while running. `blocked` = Kleinanzeigen showed a captcha or 403/429; stop and keep the partial results.

## No account handling
The backend never logs into Kleinanzeigen and has no `/api/auth/*` or `/api/watchlist/*` routes. The user is signed in on kleinanzeigen.de in their own browser; the UI links each result to the ad (`url`, opened in a new tab) and the header to the Merkliste (https://www.kleinanzeigen.de/m-merkliste.html), where saving and messaging happen.

## Persistence (`data/user/store.json`, git-ignored)
Single JSON file, created on first write, written atomically (temp file + rename). JSON bodies are limited to 1 MB (413 `{ "error": ... }`). Invalid input → 400, unknown id → 404, both `{ "error": "..." }`. Timestamps are ISO-8601 strings. Everything here is local; nothing is sent to Kleinanzeigen.

### Routes
- `GET /api/routes` → `[{ "id": "a1b2c3d4e5f6", "name": "Kassel–Göttingen", "updatedAt": "2026-10-26T10:00:00.000Z" }]` (newest first)
- `GET /api/routes/:id` → full route:
```json
{ "id": "a1b2c3d4e5f6", "name": "Kassel–Göttingen",
  "waypoints": [{ "label": "Kassel", "lat": 51.31, "lon": 9.48, "radiusKm": 0 },
                { "label": "Göttingen", "lat": 51.54, "lon": 9.93, "radiusKm": 10 }],
  "items": [{ "query": "Fahrrad", "minPrice": 50, "maxPrice": null }],
  "corridorKm": 20, "geometry": "<LineString or null>", "distanceKm": 48.2, "durationMin": 40,
  "results": ["<search result objects, max 500>"], "searchedAt": "2026-10-26T10:05:00.000Z",
  "updatedAt": "2026-10-26T10:05:01.000Z" }
```
- `POST /api/routes` with the same fields (without `id`/`updatedAt`) → **201** + full route. Only `name` (1–120 chars) is required; defaults: `waypoints: []`, `items: []`, `corridorKm: 20`, `geometry/distanceKm/durationMin/searchedAt: null`, `results: []`.
- `PUT /api/routes/:id` — any subset of the fields; given fields replace the stored ones (arrays wholesale), others stay → full route. `updatedAt` is set by the server.
- `DELETE /api/routes/:id` → `{ "ok": true }`

Validation: `waypoints` ≤ 10, each with finite `lat`/`lon`, `radiusKm` ∈ 0,5,10,20,30,50 (default 0), `label` string; `items` ≤ 50 each with non-empty `query`, `minPrice`/`maxPrice` number or null; `corridorKm` in (0, 200]; `geometry` LineString or null; `results` array of objects (silently truncated to the first 500); `searchedAt` ISO string or null.

### Merkliste (app-local favourites, global across routes, keyed by adid)
- `GET /api/merkliste` → `[{ "adid": "3012345678", "ad": { "adid": "3012345678", "title": "...", "url": "...", "...": "result snapshot" }, "routeId": "a1b2c3d4e5f6", "savedAt": "2026-10-26T10:06:00.000Z" }]` (newest first)
- `PUT /api/merkliste/:adid` `{ "ad": { ...result snapshot }, "routeId": "a1b2c3d4e5f6" }` (`routeId` string or null) → the entry above (**200**; re-saving keeps the original `savedAt`; `ad.adid` is forced to `:adid`). `adid` must match `[A-Za-z0-9_-]{1,40}`.
- `DELETE /api/merkliste/:adid` → `{ "ok": true }` (404 if not saved)

### Contact log (the user's own notes; the app cannot read Kleinanzeigen messages)
`status` ∈ `"none"`, `"angeschrieben"`, `"antwort"`, `"vereinbart"`, `"abgeholt"`, `"abgesagt"`.
- `GET /api/contacts` → `{ "3012345678": { "status": "angeschrieben", "notes": [{ "id": "f00ba4c0ffee", "text": "Antwort morgen", "at": "2026-10-26T10:07:00.000Z" }], "updatedAt": "2026-10-26T10:07:00.000Z" } }` (only ads that have an entry; `{}` if none)
- `PUT /api/contacts/:adid` `{ "status": "angeschrieben" }` → `{ "status", "notes", "updatedAt" }` (creates the entry if needed)
- `POST /api/contacts/:adid/notes` `{ "text": "Antwort morgen" }` (1–2000 chars) → **201** `{ "id", "text", "at" }` (creates the entry with status `"none"` if needed)
- `DELETE /api/contacts/:adid/notes/:noteId` → `{ "ok": true }` (404 if ad or note unknown)

## Messaging links (no endpoint)
The user replies in their own, logged-in browser. The frontend links to the ad (`result.url`, new tab) and to the Kleinanzeigen inbox https://www.kleinanzeigen.de/m-nachrichten.html (Merkliste: https://www.kleinanzeigen.de/m-merkliste.html).
