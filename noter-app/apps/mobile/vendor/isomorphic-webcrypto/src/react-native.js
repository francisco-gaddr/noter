/**
 * Vendored isomorphic-webcrypto/src/react-native — the exact subpath lib0's
 * `webcrypto.react-native.cjs` requires. Re-exports the already-polyfilled global.crypto
 * (react-native-get-random-values, imported first in index.js + app/_layout.tsx). yjs core
 * only needs getRandomValues; `subtle` is unused on the CRDT path.
 *
 * This vendored package means Metro's DEFAULT resolver resolves the module — so it works
 * even if the metro.config custom resolver is bypassed/cached. Mirrors shims/lib0-webcrypto.js.
 */
'use strict';

const g = (typeof global !== 'undefined' && global.crypto) ? global.crypto
  : (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto
  : (typeof crypto !== 'undefined' ? crypto : undefined);

if (!g || typeof g.getRandomValues !== 'function') {
  throw new Error(
    'isomorphic-webcrypto shim: global.crypto.getRandomValues is unavailable. ' +
    'Ensure react-native-get-random-values is imported before yjs.'
  );
}

const api = {
  getRandomValues: g.getRandomValues.bind(g),
  subtle: g.subtle, // may be undefined in RN; unused by yjs core / our CRDT path
  ensureSecure() { return Promise.resolve(); },
};

module.exports = api;
module.exports.default = api;
