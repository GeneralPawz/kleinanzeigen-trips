# Kleinanzeigen.de unofficial API / scraper survey

Researched 2026-10-26. The HTML findings below come from live `curl` fetches that day. Project facts come from GitHub/PyPI pages. Last-commit dates were mostly not visible on the pages, so "activity" is inferred from changelogs and release dates.

## 1. Projects

| Project | Lang | Activity | Supports | How it works | License |
|---|---|---|---|---|---|
| [DanielWTE/ebay-kleinanzeigen-api](https://github.com/DanielWTE/ebay-kleinanzeigen-api) (FastAPI) | Python 3.14+ | Active: changelog entries May 2026 (maintainer Darko Palić), 82 commits, 248★ | `GET /inserate` (query, location, radius, price min/max, pages), `/inserat/{id}` (details, all images), `/inserate-detailed`, `POST /inserate-by-url`, `/convert-url`. Publish-date filter, 404 on deleted ads. **No login, no messaging.** | Playwright/Chromium scraping with pooled contexts and delays between pages | MIT |
| [ek-scraper](https://pypi.org/project/ek-scraper/) | Python 3.11+ | 0.3.0 released 2026-10-13 | Takes a search URL and returns new ads (all pages). Regex exclusion filters. Pushover/ntfy/email alerts. No details, login or messaging. | Plain HTTP + HTML parsing, run from cron | MIT |
| [Second-Hand-Friends/kleinanzeigen-bot](https://github.com/Second-Hand-Friends/kleinanzeigen-bot) | Python 3.12–3.15 | Very active (1,157 commits, 2026 copyright, 436★) | Manages **your own ads** (publish, update, delete, republish, download, extend). **Does not search the marketplace.** Login from `config.yaml`, or a manual `login` command for captcha/SMS. | Browser automation (Chromium, remote-debugging attach is possible) | AGPL-3.0+ |
| [Sprayer115/ebay-kleinanzeigen-api-mcp](https://github.com/Sprayer115/ebay-kleinanzeigen-api-mcp) | Python | Unknown | Rewrite of DanielWTE as an MCP server (search + details) | Scraping, like the original | Not checked |
| [patchwork-lab/kleinanzeigen-bot](https://github.com/patchwork-lab/kleinanzeigen-bot) | Python | Unknown | Auto-messages sellers when a matching ad appears | Browser automation | Not checked |
| jsr.io `@dnascanner/kleinanzeigen` | TS | Not checked | Search wrapper | Not checked | Not checked |
| Commercial: Apify actors, ScrapingBee, Decodo | n/a | Active | Search + details as a paid service, with proxies and anti-bot handled | Hosted | Paid |

- **Mobile JSON API:** I found no maintained open-source project that documents `api.kleinanzeigen.de/api`. It needs app credentials and device auth, so I would not rely on it. The old eBay-era wrappers that used it are stale and I did not verify them.
- **Not checked:** I did not clone or audit any repo's code, so the "supports" column is README-level.

## 2. Recommendation: own thin scraper over plain HTTP + HTML parsing

Plain `fetch`/`requests` plus an HTML parser returned full results with no Playwright and no login.

- DanielWTE's API needs Python 3.14 and Chromium, which is heavy for a personal app. It is still a good reference for field extraction and as a fallback if plain HTTP gets blocked.
- Our backend should call the URLs below directly and parse the HTML. If we need a browser later, add Playwright only for the detail page or login.
- Keep a small HTML-parsing module so selector changes are a one-file fix.

## 3. Search URLs (verified with curl, HTTP 200, ~780 KB, 27 `<article>` per page)

Path-based, no query string:

```
/s-{PLZ-or-city}/{keyword}/k0r{radiusKm}            e.g. /s-80331/fahrrad/k0r30
/s-{PLZ}/preis:{min}:{max}/{keyword}/k0r{radius}    e.g. /s-80331/preis:50:300/fahrrad/k0r30  (200, works)
/s-seite:{n}/{keyword}/k0r{radius}                  pagination, e.g. /s-seite:2/fahrrad/k0r30
/s-fahrrad/k0                                       keyword only, nationwide (200)
```

- `k0` means all categories. A category id replaces it (`k0` → `c217` etc.).
- `l{locationId}` is the internal location id. The server adds it itself: `/s-80331/fahrrad/k0r30` is the canonical form, and requesting the PLZ form returns the page directly.
- `/s-suchanfrage.html?keywords=…&locationStr=80331&radius=30` answers **301** to `/s-80331/fahrrad/k0l6443r30`. It is listed in robots.txt as Disallow, so don't use it.
- Location id 6443 = PLZ 80331. Ids are obtained from that redirect or the suggest endpoint below.
- Radius is in km. The site's UI offers fixed steps (5, 10, 20, 30, 50, 100, 150, 200). Stick to those, because I did not test arbitrary values.
- Location suggest (JSON): `GET /s-ort-empfehlungen.json?query=Muenchen` → `{"_0":"Deutschland","_6411":"München - Bayern"}` (keys are `_{locationId}`).
- Sort and other filters are also path segments (e.g. `sortierung:` and `anzeigeart:`). I did not verify those, so check them in the browser before use.
- robots.txt disallows `/s-suchanfrage.html`, `/s-feed.rss`, `/s-oac`, `/s-poac`, `/s-paketdienst:*`, `/s-direktkaufen:aktiv`. The path-style `/s-…/k0` URLs are not disallowed.

## 4. Search-result HTML structure

The page is server-rendered (Astro, Tailwind utility classes). The hashed/utility class names are unstable, so anchor on `article`, `data-*` attributes, JSON-LD and tag structure, not on class names.

| Field | Where |
|---|---|
| Item container | `article[data-adid]` |
| Ad id | `article@data-adid` (also the numeric part of the URL) |
| Link | `article@data-href`, e.g. `/s-anzeige/{slug}/{adid}-{categoryId}-{n}` (prefix `https://www.kleinanzeigen.de`) |
| Title | `article h3 a` text |
| Description snippet | `article h3 ~ p` (truncated, ends with "…") |
| Price | `p` after the title block, e.g. `600 € VB` / `Zu verschenken` (parse number + `VB`) |
| **Location (PLZ + city)** | first `span` in the top row, e.g. `<span>74575 Schrozberg</span>` (with a location-pin svg beside it) |
| Date | `<span>Heute, 10:30</span>` / `Gestern, …` / `dd.mm.yyyy`. Missing on promoted ads. |
| Image | `img[src]` in `[data-image-container]`, host `img.kleinanzeigen.de/api/v1/prod-ads/images/…?rule=$_2.AUTO` (`$_35` / `$_59` are larger sizes). Image count is the small badge number in the same container. |
| Image (alternative) | `script[type="application/ld+json"]` inside the article, an ImageObject with `contentUrl` and `title` |
| Pagination | links `/s-seite:N/…` |

- Promoted/top ads sit among the 27 articles and have no date (the first two had none in my sample). Skip articles without a date, or accept them but flag them.
- The `alt` on the image repeats the title and adds `{Bundesland} - {City}`.
- No lat/lon appears in the search list.

## 5. Coordinates for each result

1. **PLZ + city** from the list item (`74575 Schrozberg`). This is enough for "near route" matching, so no detail fetch is needed.
2. **Geocode PLZ → lat/lon** locally. Use a static German PLZ centroid table (e.g. the GeoNames `DE` postal-code dump, CC-BY) loaded into SQLite/JSON, so we make no per-result network calls.
3. Cities-only items (no PLZ, which is rare) need a Nominatim lookup with caching, 1 req/s, and a proper User-Agent.
4. The detail page (`/s-anzeige/…`) may expose a map/coordinate. I did **not** verify this, so check it before relying on it. DanielWTE's `/inserat/{id}` is a reference for what the detail page offers.
5. Resolution is PLZ-area (a few km). Seller addresses are not exact, which suits pickup planning.

Route matching: sample points every ~20 km along the route (polyline), query each point's PLZ with `r20`–`r30`, de-duplicate by `adid`, then filter by distance to the polyline in our own code. A route over 800 km at 25 km spacing is about 35 searches per keyword, so batch and cache.

## 6. Login

- **Search needs no login.** The pages above were fetched anonymously.
- Login only helps with things that aren't search: watchlist/Merkliste, saved searches, messages, "Preis verhandeln", your own ads.
- Login is hard to automate: Kleinanzeigen uses bot detection (captcha) and SMS/email device verification, as the kleinanzeigen-bot README admits (manual `login` command, visible browser, remote-debug attach). I did not test the login endpoints.
- **Recommendation:** don't implement login in v1. If we want the watchlist later, use Playwright with a persistent profile where the user signs in manually once (store the profile in `.sessions/`, which is already in `.gitignore`), and never store the password.
- Messaging by script risks an account ban and spam flags. Better to open the ad link in the user's own browser.

## 7. Rate limits and anti-bot

- Plain `curl` with a normal browser User-Agent and `Accept-Language: de-DE` worked on the first try for 5 requests. I did not hit any block, but I made few requests.
- Per ek-scraper's README, running too often leads to IP blocks. DanielWTE adds delays between pages for the same reason.
- Be conservative: max ~1 request per 1–2 s with jitter, a sequential queue, a response cache (the TTL on search results can be 10–15 min), and back off on 403/429/captcha pages. Detect a block by a missing `article` (or a captcha page) and stop rather than retry.
- Run it from the user's home IP (the app is personal). Datacenter IPs are more likely to be blocked.
- Terms of use: Kleinanzeigen's ToS forbid automated access, and the user's account could be affected if we mix login with scraping. Keep scraping anonymous and low-volume, and treat this as personal use only.
- The HTML will change without notice (the Tailwind utility classes already look build-generated). Keep fixtures of saved pages and a parser test to detect breakage.

## 8. Decision summary

- Backend: own TypeScript/Python fetcher + HTML parser, path-style search URLs, no login.
- Locations: PLZ from the result, local PLZ centroid table for lat/lon, Nominatim only as a cached fallback.
- Fallback: DanielWTE/ebay-kleinanzeigen-api (MIT, Playwright) if plain HTTP is blocked.
- Open items: detail-page coordinates, sort/filter segments, the exact radius steps, and any login flow are unverified.
