// Node implementations of what core/ injects: HTTP (fetch), file storage, PLZ table, location-id cache.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const httpError = (res) => Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });

/** core's `http` contract on top of fetch; non-2xx rejects with an Error carrying `status`. */
export const nodeHttp = {
  async getText(url, headers) {
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) throw httpError(res);
    return res.text();
  },
  async getJson(url, headers) {
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) throw httpError(res);
    return res.json();
  },
  async postJson(url, body, headers) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (!res.ok) throw httpError(res);
    return res.json();
  },
};

export const defaultStoreFile = join(root, 'data', 'user', 'store.json');

/** JSON file storage: atomic write (temp file + rename); load() is `{}` while the file does not exist. */
export function fileStorage(file) {
  return {
    async load() {
      let text;
      try {
        text = await readFile(file, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return {};
        throw e;
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`${file} ist beschädigt: ${e.message}`);
      }
    },
    async save(obj) {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(obj));
      await rename(tmp, file);
    },
  };
}

export function loadPlzTable() {
  const file = join(root, 'data', 'plz-de.json');
  if (!existsSync(file)) {
    console.warn('data/plz-de.json missing — run `npm run build:plz`');
    return { plz: {}, cities: {} };
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const locFile = join(root, 'data', 'cache', 'location-ids.json');
export function loadLocIds() {
  try {
    if (existsSync(locFile)) return JSON.parse(readFileSync(locFile, 'utf8'));
  } catch {
    /* start empty */
  }
  return {};
}
export function saveLocIds(ids) {
  mkdirSync(dirname(locFile), { recursive: true });
  writeFileSync(locFile, JSON.stringify(ids));
}
