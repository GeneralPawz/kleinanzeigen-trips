import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getStore } from './store.js';

export const POLL_MS = 2 * 60 * 1000;
const PRESETS = { gmail: { host: 'imap.gmail.com', port: 993 }, gmx: { host: 'imap.gmx.net', port: 993 } };
const SENDER_DOMAINS = ['kleinanzeigen.de', 'ebay-kleinanzeigen.de'];
const BASE = 'https://www.kleinanzeigen.de';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- config ------------------------------------------------------------------------------------
export function mailConfig(env = process.env) {
  const provider = (env.MAIL_PROVIDER || '').trim().toLowerCase();
  const user = (env.MAIL_USER || '').trim();
  const pass = env.MAIL_PASS || '';
  const lookbackDays = Number(env.MAIL_LOOKBACK_DAYS) > 0 ? Number(env.MAIL_LOOKBACK_DAYS) : 30;
  const preset = PRESETS[provider];
  const host = preset?.host || (provider === 'custom' ? (env.MAIL_HOST || '').trim() : '');
  const port = preset?.port || Number(env.MAIL_PORT) || 993;
  const configured = Boolean(host && user && pass);
  return { configured, provider: provider || null, user, pass, host, port, lookbackDays };
}

export function maskUser(user) {
  const [name, domain] = String(user || '').split('@');
  if (!name) return null;
  return `${name[0]}***${domain ? '@' + domain : ''}`;
}

// --- parsing -----------------------------------------------------------------------------------
export function isKleinanzeigenSender(address) {
  const domain = String(address || '').toLowerCase().split('@').pop();
  return SENDER_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}

const decodeSafe = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const unescapeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"');
/** Text with HTML entities and two rounds of URL-decoding so links inside tracking redirects show up. */
const searchable = (s) => decodeSafe(decodeSafe(unescapeHtml(s)));

const AD_LINK = /\/s-anzeige\/([^\s"'<>/?#]+)\/(\d{6,})-\d+-\d+/;
const AD_ID_FALLBACKS = [/[?&;]ad[-_]?id=(\d{6,})/i, /Anzeigen?-?(?:ID|Nr\.?|nummer)\s*:?\s*(\d{6,})/i];
const CONV_LINK = /https?:\/\/[^\s"'<>]*\/m-nachrichten\.html[^\s"'<>\]]*/i;
const MESSAGE_SUBJECT = /nachricht|anfrage|antwort|geschrieben|message/i;
const QUOTES = /[„“"»«‚‘'`]([^„“"»«‚‘'`]{3,200})[“”"«»’'`]/;

export function titleFromSubject(subject) {
  const q = QUOTES.exec(subject);
  if (q) return q[1].trim();
  const m = /(?:zu(?: deiner| Ihrer| der)?(?: Anzeige)?|Anzeige)\s*:?\s+(.{3,200})$/i.exec(subject);
  return m ? m[1].replace(/[.!]+$/, '').trim() : null;
}

const slugTitle = (slug) => decodeSafe(slug).replace(/-+/g, ' ').trim();
const cleanLink = (u) => u.replace(/[)>.,;]+$/, '');

/**
 * Parse one raw RFC 822 message. Returns null if the sender is not a Kleinanzeigen domain.
 * Only metadata is returned, never the body.
 */
export async function parseMail(raw) {
  const m = await simpleParser(raw);
  const from = m.from?.value?.[0]?.address;
  if (!isKleinanzeigenSender(from)) return null;
  const subject = (m.subject || '').replace(/\s+/g, ' ').trim();
  const text = searchable(`${m.text || ''}\n${typeof m.html === 'string' ? m.html : ''}`);

  let adid = null;
  let slug = null;
  let adUrl = null;
  const al = AD_LINK.exec(text);
  if (al) {
    slug = al[1];
    adid = al[2];
    adUrl = BASE + al[0];
  }
  if (!adid) {
    for (const re of AD_ID_FALLBACKS) {
      const f = re.exec(text) || re.exec(subject);
      if (f) {
        adid = f[1];
        break;
      }
    }
  }

  let title = titleFromSubject(subject);
  let titleFrom = title ? 'subject' : null;
  if (!title && slug) {
    const a = new RegExp(`<a[^>]+${AD_LINK.source}[^>]*>([^<]{3,200})</a>`, 'i').exec(text);
    if (a) {
      title = a[3].replace(/\s+/g, ' ').trim();
      titleFrom = 'link';
    } else {
      title = slugTitle(slug);
      titleFrom = 'slug';
    }
  }

  const cl = CONV_LINK.exec(text);
  const link = cl ? cleanLink(cl[0]) : adUrl;
  const isMessage = MESSAGE_SUBJECT.test(subject) || Boolean(cl);
  return { at: (m.date || new Date()).toISOString(), subject, adid, title, titleFrom, adUrl, link, isMessage };
}

// --- matching ----------------------------------------------------------------------------------
export function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const tokens = (t) => new Set(normTitle(t).split(' ').filter((w) => w.length > 1));

/** Exact normalized match, or token overlap (≥ 2 shared tokens, overlap ≥ 0.8 of the smaller set, Jaccard ≥ 0.6). */
export function titleSimilar(a, b) {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  if (shared < 2) return false;
  return shared / Math.min(ta.size, tb.size) >= 0.8 && shared / (ta.size + tb.size - shared) >= 0.6;
}

/** @returns {{adid:string, match:'adid'|'title'}|null}; ads = [{adid,title}] known to the app. */
export function matchNotification(n, ads) {
  if (n.adid) return { adid: n.adid, match: 'adid' };
  if (!n.title) return null;
  const norm = normTitle(n.title);
  const exact = ads.filter((a) => normTitle(a.title) === norm);
  if (exact.length) return { adid: exact[0].adid, match: 'title' };
  const fuzzy = ads.filter((a) => titleSimilar(n.title, a.title));
  return fuzzy.length === 1 ? { adid: fuzzy[0].adid, match: 'title' } : null; // ambiguous → unmatched
}

/** Group message notifications by ad. seen = {adid: ISO}. */
export function buildNotifications(items, ads, seen = {}) {
  const byAd = {};
  const unmatched = [];
  const sorted = items.filter((n) => n.isMessage).sort((a, b) => a.at.localeCompare(b.at));
  for (const n of sorted) {
    const hit = matchNotification(n, ads);
    if (!hit) {
      unmatched.push({ subject: n.subject, at: n.at, link: n.link });
      continue;
    }
    const e = (byAd[hit.adid] ||= { count: 0, unseen: 0, lastAt: null, lastSubject: null, link: null, match: 'title' });
    e.count++;
    if (!seen[hit.adid] || n.at > seen[hit.adid]) e.unseen++;
    e.lastAt = n.at;
    e.lastSubject = n.subject;
    e.link = n.link || e.link;
    if (hit.match === 'adid') e.match = 'adid';
  }
  return { byAd, unmatched: unmatched.reverse() };
}

// --- IMAP --------------------------------------------------------------------------------------
/**
 * Read-only IMAP fetch of Kleinanzeigen mails from INBOX. `known` = cache keys already indexed (their bodies
 * are not downloaded again). Returns { items: [{key, ...meta}], keys: every key currently in the window }.
 */
export async function fetchKleinanzeigenMails(cfg, known = new Set()) {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port !== 143,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  client.on('error', () => {}); // surfaced through the rejected promise instead
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const validity = String(client.mailbox.uidValidity);
      const since = new Date(Date.now() - cfg.lookbackDays * 86400000);
      const uids = (await client.search({ from: 'kleinanzeigen', since }, { uid: true })) || [];
      const keys = uids.map((u) => `${validity}:${u}`);
      const fresh = uids.filter((u) => !known.has(`${validity}:${u}`));
      const items = [];
      if (fresh.length) {
        for await (const msg of client.fetch(fresh, { uid: true, source: true }, { uid: true })) {
          const meta = await parseMail(msg.source).catch(() => null);
          items.push({ key: `${validity}:${msg.uid}`, ...(meta || { skip: true }) });
        }
      }
      return { items, keys };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// --- service -----------------------------------------------------------------------------------
const indexPath = () =>
  process.env.MAIL_INDEX ||
  join(process.env.TROEDEL_STORE ? dirname(process.env.TROEDEL_STORE) : join(root, 'data', 'user'), 'mail-index.json');

function loadIndex(file) {
  try {
    if (existsSync(file)) return { items: [], seen: {}, lastCheck: null, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    /* corrupt cache: rebuilt from the mailbox */
  }
  return { items: [], seen: {}, lastCheck: null };
}
function saveIndex(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}

let index = null;
let error = null;
let running = null;
const idx = () => (index ||= loadIndex(indexPath()));

export function mailStatus() {
  const cfg = mailConfig();
  return {
    configured: cfg.configured,
    provider: cfg.configured ? cfg.provider : null,
    user: cfg.configured ? maskUser(cfg.user) : null,
    lastCheck: cfg.configured ? idx().lastCheck : null,
    error,
  };
}

async function knownAds() {
  const st = getStore();
  const ads = new Map();
  const add = (a) => a?.adid && a.title && ads.set(String(a.adid), { adid: String(a.adid), title: a.title });
  for (const { id } of await st.listRoutes()) (await st.getRoute(id)).results.forEach(add);
  (await st.listMerkliste()).forEach((e) => add(e.ad));
  return [...ads.values()];
}

export async function mailNotifications() {
  if (!mailConfig().configured) return { byAd: {}, unmatched: [] };
  const i = idx();
  return buildNotifications(i.items, await knownAds(), i.seen);
}

export function markSeen(adid) {
  const i = idx();
  i.seen[adid] = new Date().toISOString();
  saveIndex(indexPath(), i);
}

/** Run one check (concurrent calls share a run). Never rejects; errors land in mailStatus().error. */
export function checkMail() {
  const cfg = mailConfig();
  if (!cfg.configured) return Promise.resolve(mailStatus());
  running ||= (async () => {
    try {
      const i = idx();
      const { items, keys } = await fetchKleinanzeigenMails(cfg, new Set(i.items.map((n) => n.key)));
      const live = new Set(keys);
      const added = items.filter((n) => !n.skip);
      i.items = [...i.items.filter((n) => live.has(n.key)), ...added];
      i.lastCheck = new Date().toISOString();
      saveIndex(indexPath(), i);
      error = null;
      console.log(`Mail: ${keys.length} Kleinanzeigen-Mails im Zeitraum, ${added.length} neu indiziert, ${i.items.length} gesamt`);
    } catch (e) {
      error = String(e.responseText || e.message || e).split(cfg.pass).join('***').slice(0, 300);
      console.log(`Mail-Abfrage fehlgeschlagen: ${error}`);
    } finally {
      running = null;
    }
  })();
  return running.then(mailStatus);
}

export function startMailPolling() {
  if (!mailConfig().configured) return console.log('Mail: nicht konfiguriert (MAIL_PROVIDER/MAIL_USER/MAIL_PASS)');
  checkMail();
  setInterval(checkMail, POLL_MS).unref();
}
