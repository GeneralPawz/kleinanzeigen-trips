import { createStore } from '../core/store.js';
import { fileStorage, defaultStoreFile } from './adapters.js';

let shared;
/** Lazily created default store (data/user/store.json or TROEDEL_STORE); the file is written on first mutation. */
export const getStore = () => (shared ||= createStore(fileStorage(process.env.TROEDEL_STORE || defaultStoreFile)));
