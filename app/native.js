// Entry of the Android bundle: runs before public/app.js (module scripts are deferred).
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { localApi } from './local-api.js';
import { initUpdater, checkForUpdates, checkOnStart, isDialogOpen, closeDialog } from './updater.js';

if (Capacitor.isNativePlatform()) {
  const Installer = registerPlugin('Installer');
  window.TROEDEL_LOCAL_API = localApi;
  const TroedelApp = { version: null, checkForUpdates };
  window.TroedelApp = TroedelApp;
  initUpdater().then((v) => {
    TroedelApp.version = v;
    checkOnStart();
  });

  // Back: update dialog → drawer / map pane (handled by the UI) → exit
  App.addListener('backButton', () => {
    if (isDialogOpen()) return closeDialog();
    if (!window.TroedelUi?.back()) App.exitApp();
  });

  // System bar colour follows the theme (<meta name=theme-color> is kept up to date by app.js)
  const meta = document.querySelector('meta[name=theme-color]');
  // header colour under the status bar, tab-bar surface under the navigation bar
  const syncBars = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    Installer.setBarColor({ color: meta?.content || '#1D4B00', navColor: dark ? '#172015' : '#ffffff' }).catch(() => {});
  };
  if (meta) new MutationObserver(syncBars).observe(meta, { attributes: true, attributeFilter: ['content'] });
  syncBars();
}
