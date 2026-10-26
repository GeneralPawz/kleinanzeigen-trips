// Self-update from GitHub Releases: check → in-app dialog → download APK → system installer.
import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';

const Installer = registerPlugin('Installer');

const RELEASE_URL = 'https://api.github.com/repos/GeneralPawz/kleinanzeigen-trips/releases/latest';
const LAST_CHECK_KEY = 'troedeltour.update.lastCheck';
const DAY = 24 * 60 * 60 * 1000;

let installed = '0.0.0';

const parseVer = (v) => String(v).replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
export function isNewer(tag, current) {
  const a = parseVer(tag);
  const b = parseVer(current);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

async function fetchLatest() {
  const res = await fetch(RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return null; // no release yet
  if (!res.ok) throw new Error(`GitHub antwortete mit HTTP ${res.status}`);
  const r = await res.json();
  const apk = (r.assets || []).find((a) => /\.apk$/i.test(a.name));
  return { tag: r.tag_name, notes: r.body || '', apkUrl: apk?.browser_download_url || null, apkName: apk?.name || 'troedeltour.apk' };
}

// ---- UI (own DOM, themed with the app's CSS variables) -------------------------------------
const css = `
.upd-back{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px}
.upd-box{background:var(--surface);color:var(--text);border-radius:var(--radius);max-width:420px;width:100%;max-height:85vh;display:flex;flex-direction:column;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.upd-box h2{margin:0 0 8px;font-size:18px}
.upd-notes{white-space:pre-wrap;overflow:auto;font-size:13px;color:var(--muted);margin:0 0 12px;max-height:40vh}
.upd-box progress{width:100%;margin:8px 0}
.upd-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.upd-banner{position:fixed;left:8px;right:8px;bottom:calc(var(--sab,0px) + 64px);z-index:1500;background:var(--banner-bg);border:1px solid #e0b93a;border-radius:10px;padding:8px 12px;display:flex;gap:8px;align-items:center;font-size:14px;color:var(--text)}
.upd-banner span{flex:1}
`;
let styled = false;
const ensureStyle = () => {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.append(s);
};
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};
const btn = (text, onclick, primary) => h('button', { type: 'button', class: `btn btn-small ${primary ? 'btn-primary' : 'btn-ghost'}`, text, onclick });

let dialog = null;
let busy = false;
let pendingApk = null; // { uri } once downloaded

export const isDialogOpen = () => !!dialog;
export function closeDialog() {
  if (busy) return; // don't abandon a running download silently
  dialog?.remove();
  dialog = null;
}

function render(...content) {
  ensureStyle();
  dialog?.remove();
  dialog = h('div', { class: 'upd-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'App-Update' }, h('div', { class: 'upd-box' }, ...content));
  document.body.append(dialog);
}

function showInfo(rel) {
  pendingApk = null;
  render(
    h('h2', { text: `Update ${rel.tag} verfügbar` }),
    h('p', { class: 'small-note', text: `Installiert: ${installed}` }),
    h('pre', { class: 'upd-notes', text: rel.notes.trim() || 'Keine Versionshinweise.' }),
    h('div', { class: 'upd-row' },
      btn('Später', closeDialog),
      rel.apkUrl ? btn('Installieren', () => startInstall(rel), true) : h('span', { class: 'small-note', text: 'Release ohne APK-Datei.' })),
  );
}

function showMessage(title, text, ...buttons) {
  render(h('h2', { text: title }), h('p', { text }), h('div', { class: 'upd-row' }, ...buttons));
}

async function startInstall(rel) {
  const { allowed } = await Installer.canInstall();
  if (!allowed) return showNeedPermission(rel);
  if (pendingApk?.tag === rel.tag) return launchInstaller(rel);
  busy = true;
  const bar = h('progress', { max: '100', value: '0' });
  const label = h('p', { class: 'small-note', text: 'Lade herunter …' });
  render(h('h2', { text: `Lade ${rel.tag} …` }), bar, label);
  const sub = await Filesystem.addListener('progress', ({ bytes, contentLength }) => {
    if (!contentLength) return;
    bar.value = Math.round((bytes / contentLength) * 100);
    label.textContent = `${(bytes / 1048576).toFixed(1)} von ${(contentLength / 1048576).toFixed(1)} MB`;
  });
  try {
    await Filesystem.downloadFile({ url: rel.apkUrl, path: `update/${rel.apkName}`, directory: Directory.Cache, recursive: true, progress: true });
    const { uri } = await Filesystem.getUri({ path: `update/${rel.apkName}`, directory: Directory.Cache });
    pendingApk = { tag: rel.tag, uri };
  } catch (e) {
    busy = false;
    sub.remove();
    return showMessage('Download fehlgeschlagen', String(e?.message || e), btn('Schließen', closeDialog), btn('Erneut versuchen', () => startInstall(rel), true));
  }
  busy = false;
  sub.remove();
  launchInstaller(rel);
}

function showNeedPermission(rel) {
  showMessage(
    'Installation erlauben',
    'Android muss der Trödeltour erlauben, Apps zu installieren („Unbekannte Apps installieren“). Aktiviere den Schalter und komm dann zurück – die Installation geht danach weiter.',
    btn('Abbrechen', closeDialog),
    btn('Einstellungen öffnen', () => {
      awaitingPermission = rel;
      Installer.openInstallSettings();
    }, true),
  );
}

async function launchInstaller(rel) {
  try {
    await Installer.install({ path: pendingApk.uri });
    showMessage('Installation gestartet', 'Bestätige die Installation im Android-Dialog. Die App wird dabei neu gestartet.', btn('Schließen', closeDialog));
  } catch (e) {
    if (e?.message === 'PERMISSION') return showNeedPermission(rel);
    showMessage('Installation fehlgeschlagen', String(e?.message || e), btn('Schließen', closeDialog), btn('Erneut versuchen', () => launchInstaller(rel), true));
  }
}

let awaitingPermission = null;
App.addListener('resume', async () => {
  const rel = awaitingPermission;
  if (!rel || !dialog) return;
  awaitingPermission = null;
  if ((await Installer.canInstall()).allowed) startInstall(rel);
});

function showBanner(rel) {
  if (document.querySelector('.upd-banner')) return;
  ensureStyle();
  const b = h('div', { class: 'upd-banner', role: 'status' }, h('span', { text: `Update ${rel.tag} verfügbar` }),
    btn('Ansehen', () => { b.remove(); showInfo(rel); }, true), btn('×', () => b.remove()));
  document.body.append(b);
}

/** Manual check. Resolves to a short status string for the settings page; opens the update dialog if newer. */
export async function checkForUpdates() {
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  const rel = await fetchLatest();
  if (!rel) return 'Noch keine Version veröffentlicht.';
  if (!isNewer(rel.tag, installed)) return `Du hast die aktuelle Version (${installed}).`;
  showInfo(rel);
  return `Update ${rel.tag} verfügbar.`;
}

/** Silent check at app start, at most once per day; shows a banner when an update exists. */
export async function checkOnStart() {
  const last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
  if (Date.now() - last < DAY) return;
  try {
    const rel = await fetchLatest();
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    if (rel && isNewer(rel.tag, installed)) showBanner(rel);
  } catch {
    /* offline or rate-limited: try again next start */
  }
}

export async function initUpdater() {
  installed = (await App.getInfo()).version;
  return installed;
}
