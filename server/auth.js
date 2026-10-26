import { rm, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional Kleinanzeigen account support via Playwright. The user signs in by hand in a visible
// Chromium window; only the browser profile (cookies) is stored in .sessions/ — never a password.

const PROFILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.sessions', 'ka-profile');
const BASE = 'https://www.kleinanzeigen.de';
const LOGIN_URL = `${BASE}/m-einloggen.html`;
const CHECK_URL = `${BASE}/m-meine-anzeigen.html`;
const LOGIN_TIMEOUT = 5 * 60 * 1000;

let pw = null;
let pwChecked = false;
async function playwright() {
  if (!pwChecked) {
    pwChecked = true;
    try {
      pw = await import('playwright');
    } catch {
      pw = null;
    }
  }
  return pw;
}

/** The open (visible) login context, if any. */
let loginCtx = null;
let loginPromise = null;
/** Serialises headless uses of the profile (Chromium locks it). */
let lock = Promise.resolve();
const withLock = (fn) => {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
};

export async function isAvailable() {
  return !!(await playwright());
}

const launch = async (headless) => (await playwright()).chromium.launchPersistentContext(PROFILE, { headless, locale: 'de-DE' });

/** Logged in <=> the "my ads" page answers without redirecting to the login page. */
async function checkLoggedIn(ctx) {
  const res = await ctx.request.get(CHECK_URL, { maxRedirects: 0, failOnStatusCode: false });
  return res.status() === 200;
}

async function readUsername(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/m-meine-anzeigen.html`, { waitUntil: 'domcontentloaded' });
    const selectors = ['[data-testid="user-name"]', '.userprofile-vip-name', '#user-email', '.header-user-name', '[class*="user"] [class*="name"]'];
    for (const s of selectors) {
      const t = (await page.locator(s).first().textContent({ timeout: 1500 }).catch(() => null))?.trim();
      if (t && t.length < 80) return t;
    }
    const title = await page.title();
    const m = title.match(/^(?:Hallo,?\s+)?(.+?)\s*[-|]/);
    return m && !/Meine Anzeigen|Kleinanzeigen/i.test(m[1]) ? m[1] : null;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function status() {
  if (!(await playwright())) return { loggedIn: false, username: null, available: false };
  if (loginCtx) {
    // visible window is open: it owns the profile, so ask through it
    try {
      const loggedIn = await checkLoggedIn(loginCtx);
      return { loggedIn, username: loggedIn ? await readUsername(loginCtx) : null, available: true };
    } catch {
      return { loggedIn: false, username: null, available: true };
    }
  }
  return withLock(async () => {
    let ctx;
    try {
      ctx = await launch(true);
      const loggedIn = await checkLoggedIn(ctx);
      return { loggedIn, username: loggedIn ? await readUsername(ctx) : null, available: true };
    } catch {
      return { loggedIn: false, username: null, available: true };
    } finally {
      await ctx?.close().catch(() => {});
    }
  });
}

export async function login() {
  if (!(await playwright())) throw new Error('Playwright ist nicht installiert (npm install playwright && npx playwright install chromium)');
  if (loginPromise) return loginPromise;
  loginPromise = withLock(async () => {
    await mkdir(PROFILE, { recursive: true });
    let ctx;
    try {
      ctx = await launch(false);
      loginCtx = ctx;
      let closed = false;
      ctx.on('close', () => (closed = true));
      const page = ctx.pages()[0] || (await ctx.newPage());
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
      const deadline = Date.now() + LOGIN_TIMEOUT;
      while (Date.now() < deadline && !closed) {
        await new Promise((r) => setTimeout(r, 2500));
        if (closed) break;
        if (await checkLoggedIn(ctx).catch(() => false)) {
          return { loggedIn: true, username: await readUsername(ctx) };
        }
      }
      throw new Error(closed ? 'Browserfenster wurde geschlossen' : 'Zeitüberschreitung beim Login (5 Minuten)');
    } finally {
      loginCtx = null;
      loginPromise = null;
      await ctx?.close().catch(() => {});
    }
  });
  return loginPromise;
}

export async function logout() {
  if (loginCtx) await loginCtx.close().catch(() => {});
  await withLock(() => rm(PROFILE, { recursive: true, force: true }));
  return { loggedIn: false, username: null };
}

/**
 * Best effort: open the ad headless with the saved session and click "Zur Merkliste hinzufügen"
 * (the site posts to /m-merkliste-bearbeiten.html itself, incl. its CSRF token).
 * @returns {Promise<{ok:true}|{ok:false,fallbackUrl:string}>}
 */
export async function addToWatchlist(adid, adUrl) {
  const fallback = { ok: false, fallbackUrl: adUrl || `${BASE}/s-anzeige/${adid}` };
  if (!(await playwright()) || loginCtx) return fallback;
  return withLock(async () => {
    let ctx;
    try {
      ctx = await launch(true);
      if (!(await checkLoggedIn(ctx))) return fallback;
      const page = await ctx.newPage();
      await page.goto(adUrl || `${BASE}/s-anzeige/${adid}`, { waitUntil: 'domcontentloaded' });
      const btn = page.locator('#viewad-lnk-watchlist');
      if ((await btn.getAttribute('data-action', { timeout: 5000 })) === 'remove') return { ok: true };
      await btn.click();
      await page.waitForFunction(
        () => document.querySelector('#viewad-lnk-watchlist')?.getAttribute('data-action') === 'remove',
        null,
        { timeout: 6000 },
      );
      return { ok: true };
    } catch {
      return fallback;
    } finally {
      await ctx?.close().catch(() => {});
    }
  });
}
