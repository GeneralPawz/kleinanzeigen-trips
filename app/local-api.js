// Runs the Trödeltour API inside the WebView: core/ + native HTTP (no CORS) + JSON files in the app data dir.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { createLocalApi } from '../core/index.js';

const STORE_FILE = 'troedeltour/store.json';
const LOCIDS_FILE = 'troedeltour/location-ids.json';

const httpError = (res) => Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
const withDefaults = (headers) => ({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5', ...headers });
const parseJson = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

/** core's `http` contract on CapacitorHttp (native stack; the User-Agent/Accept-Language headers are really sent). */
const http = {
  async getText(url, headers) {
    const res = await CapacitorHttp.get({ url, headers: withDefaults(headers), responseType: 'text' });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  },
  async getJson(url, headers) {
    const res = await CapacitorHttp.get({ url, headers: withDefaults(headers), responseType: 'json' });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    return parseJson(res.data);
  },
  async postJson(url, body, headers) {
    const res = await CapacitorHttp.post({
      url,
      headers: withDefaults({ 'Content-Type': 'application/json', ...headers }),
      data: body,
      responseType: 'json',
    });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    return parseJson(res.data);
  },
};

const opts = { directory: Directory.Data, encoding: Encoding.UTF8 };

async function readJson(path, fallback) {
  let text;
  try {
    text = (await Filesystem.readFile({ path, ...opts })).data;
  } catch (e) {
    if (/does not exist|not exist|no such file/i.test(String(e?.message))) return fallback;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} ist beschädigt: ${e.message}`);
  }
}

async function writeJson(path, obj) {
  const data = JSON.stringify(obj);
  const tmp = `${path}.tmp`;
  await Filesystem.writeFile({ path: tmp, data, recursive: true, ...opts });
  try {
    await Filesystem.rename({ from: tmp, to: path, directory: Directory.Data, toDirectory: Directory.Data });
  } catch {
    await Filesystem.writeFile({ path, data, recursive: true, ...opts });
  }
}

const storage = {
  load: () => readJson(STORE_FILE, {}),
  save: (obj) => writeJson(STORE_FILE, obj),
};

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

let ready = null;
/** Built on first use: location-id cache and the (1 MB) PLZ table are loaded lazily. */
function init() {
  ready ||= (async () => {
    const [locIds, plzTable] = await Promise.all([
      readJson(LOCIDS_FILE, {}),
      fetch('plz-de.json').then((r) => {
        if (!r.ok) throw new Error('PLZ-Tabelle fehlt');
        return r.json();
      }),
    ]);
    return createLocalApi({
      http,
      storage,
      plzTable,
      locIds,
      onLocIds: (ids) => void writeJson(LOCIDS_FILE, ids).catch(() => {}),
    });
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export const localApi = {
  /** Same shape as createLocalApi().handle; bodies/results are cloned so the UI cannot mutate the store. */
  async handle(method, path, body) {
    try {
      const api = await init();
      const { status, json } = await api.handle(method, path, clone(body));
      return { status, json: clone(json) };
    } catch (e) {
      return { status: 500, json: { error: e.message } };
    }
  },
};

export const isNative = () => Capacitor.isNativePlatform();
