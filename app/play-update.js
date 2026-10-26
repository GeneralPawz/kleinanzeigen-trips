// Google Play in-app updates (Play Core via @capawesome/capacitor-app-update).
import { App } from '@capacitor/app';
import { AppUpdate, AppUpdateAvailability, AppUpdateResultCode } from '@capawesome/capacitor-app-update';

const LAST_CHECK_KEY = 'troedeltour.update.lastCheck';
const DAY = 24 * 60 * 60 * 1000;
const VIA_PLAY = 'Updates kommen über Google Play.';

let installed = '0.0.0';

const css = `
.upd-banner{position:fixed;left:8px;right:8px;bottom:calc(var(--sab,0px) + 64px);z-index:1500;background:var(--banner-bg);border:1px solid #e0b93a;border-radius:10px;padding:8px 12px;display:flex;gap:8px;align-items:center;font-size:14px;color:var(--text)}
.upd-banner span{flex:1}
`;
let styled = false;
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

const getInfo = () => AppUpdate.getAppUpdateInfo();
const available = (info) => info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE
  || info.updateAvailability === AppUpdateAvailability.UPDATE_IN_PROGRESS;
const label = (info) => `Update${info.availableVersionName ? ` ${info.availableVersionName}` : ''}`;

async function install(info) {
  if (!info.immediateUpdateAllowed) return AppUpdate.openAppStore();
  const { code } = await AppUpdate.performImmediateUpdate();
  if (code === AppUpdateResultCode.NOT_ALLOWED) return AppUpdate.openAppStore();
}

function showBanner(info) {
  if (document.querySelector('.upd-banner')) return;
  if (!styled) {
    styled = true;
    document.head.append(h('style', { text: css }));
  }
  const b = h('div', { class: 'upd-banner', role: 'status' },
    h('span', { text: `${label(info)} verfügbar` }),
    btn('Aktualisieren', () => { b.remove(); install(info).catch(() => {}); }, true),
    btn('×', () => b.remove()));
  document.body.append(b);
}

/**
 * Manual check from the settings page. Resolves to { text, storeButton }: a status line and whether the page should
 * offer a Play Store button (not installed from Play, or the Play API failed).
 */
export async function checkForUpdates() {
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  let info;
  try {
    info = await getInfo();
  } catch {
    return { text: VIA_PLAY, storeButton: true };
  }
  if (!available(info)) return { text: `Du hast die neueste Version (${installed}).` };
  try {
    await install(info);
    return { text: `${label(info)} wird installiert …` };
  } catch {
    return { text: VIA_PLAY, storeButton: true };
  }
}

export const openStore = () => AppUpdate.openAppStore();

/** Silent check at app start, at most once per day; shows a banner when an update exists. */
export async function checkOnStart() {
  const last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
  if (Date.now() - last < DAY) return;
  try {
    const info = await getInfo();
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    if (available(info)) showBanner(info);
  } catch {
    /* not from Play, offline, or Play unavailable: stay silent */
  }
}

export async function initUpdater() {
  installed = (await App.getInfo()).version;
  return installed;
}
