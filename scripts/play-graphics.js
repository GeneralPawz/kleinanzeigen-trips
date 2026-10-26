// Builds the Google Play graphics in docs/play/graphics/: 512 icon, 1024x500 feature graphic, 4 phone screenshots (1080x1920).
// Screenshots come from the desktop server (own temp store, port 3111) with a real Hamburg → München search, cached in
// .tmp-play/seed.json so reruns don't hit Kleinanzeigen again. Playwright is not a dependency:
//   PLAYWRIGHT_DIR=<dir whose node_modules contains playwright> node scripts/play-graphics.js [icon|feature|shots]
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const out = join(root, 'docs', 'play', 'graphics');
const tmp = join(root, '.tmp-play');
const what = process.argv[2] || 'all';
await mkdir(out, { recursive: true });
await mkdir(tmp, { recursive: true });

// ---- icon: full-bleed 512x512, opaque (Play masks the corners itself) ----
if (what === 'all' || what === 'icon') {
  const svg = (await readFile(join(root, 'assets', 'icon.svg'), 'utf8')).replace('viewBox="0 0 108 108"', 'viewBox="18 18 72 72"');
  await sharp(Buffer.from(svg), { density: 600 }).resize(512, 512).flatten({ background: '#1D4B00' }).ensureAlpha().png().toFile(join(out, 'icon-512.png'));
  console.log('icon-512.png');
}

// ---- feature graphic 1024x500: brand green, pin on a stylised route, name + tagline ----
if (what === 'all' || what === 'feature') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1D4B00"/><stop offset="1" stop-color="#0b1a05"/></linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#B5E941" stroke-opacity=".07" stroke-width="2"/></pattern>
  </defs>
  <rect width="1024" height="500" fill="url(#bg)"/><rect width="1024" height="500" fill="url(#grid)"/>
  <path d="M470 440 C 560 380 600 300 690 330 S 830 380 900 250 S 960 90 1000 60" fill="none" stroke="#B5E941" stroke-opacity=".35" stroke-width="12" stroke-linecap="round" stroke-dasharray="2 26"/>
  <path d="M470 440 C 560 380 600 300 690 330 S 830 380 900 250" fill="none" stroke="#B5E941" stroke-width="12" stroke-linecap="round"/>
  <circle cx="470" cy="440" r="16" fill="#fff" stroke="#B5E941" stroke-width="8"/>
  <g transform="translate(840 80) scale(6)"><path d="M16 5a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#B5E941"/><path d="M12 8.5h8v2.2h-2.9v5.4h-2.2v-5.4H12z" fill="#1D4B00"/></g>
  <circle cx="690" cy="330" r="13" fill="#B5E941"/><circle cx="690" cy="330" r="5" fill="#1D4B00"/>
  <text x="64" y="240" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="104" fill="#fff">Trödeltour</text>
  <text x="68" y="304" font-family="Segoe UI, Arial, sans-serif" font-size="38" fill="#B5E941">Fundstücke auf deiner Route</text>
  <text x="68" y="360" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#fff" fill-opacity=".75">Hamburg → München – und alles Gute dazwischen</text>
</svg>`;
  await sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#1D4B00' }).png().toFile(join(out, 'feature-1024x500.png'));
  console.log('feature-1024x500.png');
}

if (what === 'all' || what === 'shots') await shots();

async function shots() {
  const PORT = 3111;
  const base = `http://localhost:${PORT}`;
  const store = join(tmp, 'store.json');
  await rm(store, { force: true });
  const server = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), TROEDEL_STORE: store }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`${base}/api/routes`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json();
      if (!res.ok) throw new Error(`${method} ${path}: ${json.error}`);
      return json;
    };
    const seedFile = join(tmp, 'seed.json');
    let seed;
    if (existsSync(seedFile)) seed = JSON.parse(await readFile(seedFile, 'utf8'));
    else {
      const places = [];
      for (const q of ['Hamburg', 'Göttingen', 'München']) {
        const [g] = await call('GET', `/api/geocode?q=${encodeURIComponent(q)}`);
        places.push({ label: q, lat: g.lat, lon: g.lon });
        await new Promise((r) => setTimeout(r, 1100));
      }
      const route = await call('POST', '/api/route', { waypoints: places });
      const items = [{ query: 'Fahrrad', minPrice: null, maxPrice: 300 }, { query: 'Plattenspieler', minPrice: null, maxPrice: null }];
      const { jobId } = await call('POST', '/api/search', { geometry: route.geometry, corridorKm: 15, items, stops: [] });
      let job;
      do {
        await new Promise((r) => setTimeout(r, 3000));
        job = await call('GET', `/api/search/${jobId}`);
        console.log(`search ${job.status} ${job.progress?.done}/${job.progress?.total} results=${job.results.length}`);
      } while (job.status === 'running');
      seed = { places, route, items, results: job.results };
      await writeFile(seedFile, JSON.stringify(seed));
    }
    const saved = await call('POST', '/api/routes', {
      name: 'Hamburg–München',
      waypoints: seed.places.map((p, i) => ({ ...p, radiusKm: 0, i })),
      items: seed.items, corridorKm: 15, searchMode: 'corridor',
      geometry: seed.route.geometry, distanceKm: seed.route.distanceKm, durationMin: seed.route.durationMin,
      results: seed.results, searchedAt: new Date().toISOString(),
    });
    // a few favourites and contact states, spread along the route
    const pick = [0.15, 0.35, 0.55, 0.75].map((f) => seed.results[Math.floor(seed.results.length * f)]).filter(Boolean);
    for (const ad of pick.slice(0, 3)) await call('PUT', `/api/merkliste/${ad.adid}`, { ad, routeId: saved.id });
    const states = ['angeschrieben', 'antwort', 'vereinbart', 'abgeholt'];
    for (const [i, ad] of pick.entries()) await call('PUT', `/api/contacts/${ad.adid}`, { status: states[i] });
    await call('POST', `/api/contacts/${pick[2].adid}/notes`, { text: 'Abholung Samstag 10 Uhr, Bargeld mitbringen' });
    await call('POST', `/api/contacts/${pick[2].adid}/notes`, { text: 'Adresse per Nachricht bekommen' });

    const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || join(tmpdir(), 'troedel-qa2'), 'x.js'))('playwright');
    const browser = await chromium.launch();
    const shoot = async (name, theme, act) => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE' });
      await ctx.addInitScript(([t, id]) => { localStorage.setItem('troedeltour.theme', t); localStorage.setItem('troedeltour.lastRoute', id); }, [theme, saved.id]);
      const page = await ctx.newPage();
      await page.goto(base);
      await page.waitForSelector('body[data-ready="1"]');
      await page.waitForTimeout(1500);
      await act(page);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(out, name) });
      console.log(name);
      await ctx.close();
    };
    const showAd = (ad) => async (p) => {
      await p.evaluate((id) => document.getElementById('card-' + id)?.click(), ad.adid);
      await p.waitForTimeout(3500);
    };
    await shoot('screenshot-1-planung.png', 'light', async (p) => {
      await p.evaluate(() => { document.getElementById('h-results').scrollIntoView({ block: 'start' }); window.scrollTo(0, 0); document.scrollingElement.scrollTop = 0; });
    });
    await shoot('screenshot-2-karte.png', 'light', showAd(pick[2]));
    await shoot('screenshot-3-kontakt.png', 'light', async (p) => {
      await p.locator('.chat-chip[data-status="vereinbart"]').first().click();
      await p.waitForTimeout(1500);
    });
    await shoot('screenshot-4-dunkel.png', 'dark', showAd(pick[1]));
    await browser.close();
  } finally {
    server.kill();
  }
}
