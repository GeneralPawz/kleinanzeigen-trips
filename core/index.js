// Platform-independent core shared by the Node server and the Capacitor app bundle.
// No node: imports here — HTTP, storage and the PLZ table are injected.
export { createLocalApi } from './api.js';
export { createPlz } from './plz.js';
export { createStore, memoryStorage, STOP_RADII, SEARCH_MODES, CONTACT_STATUSES, MAX_RESULTS } from './store.js';
export { createSearchManager, validateSearch, nearestStop } from './search.js';
export { createKleinanzeigenClient, BlockedError, buildSearchUrl, slugify, pickLocationId } from './kleinanzeigen.js';
export { parseSearch, parsePrice, looksBlocked } from './parse.js';
export { createGeocoder } from './geocode.js';
export { createRouter } from './route.js';
export { haversineKm, pointToSegment } from './geo.js';
export * from './corridor.js';
