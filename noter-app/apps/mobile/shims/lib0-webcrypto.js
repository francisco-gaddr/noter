/**
 * Shim for `isomorphic-webcrypto/src/react-native`.
 *
 * lib0 (a transitive dependency of `yjs`, used by our CRDT "Live" Markdown sync) ships a
 * React-Native webcrypto variant (`lib0/dist/webcrypto.react-native.cjs`) that hard-requires
 * the unmaintained `isomorphic-webcrypto` package. We don't want that dependency, and we
 * don't need it: `react-native-get-random-values` (imported first thing in `index.js` and
 * `app/_layout.tsx`) already polyfills `global.crypto.getRandomValues`, which is the ONLY
 * primitive yjs core uses (for generating client ids). `subtle` is unused on our CRDT path.
 *
 * This shim is aliased onto `isomorphic-webcrypto/src/react-native` by both Metro
 * (`metro.config.js` → resolveRequest, for the real app) and Jest
 * (`jest.config.js` → moduleNameMapper, for tests), so yjs loads cleanly on device and in CI.
 */
'use strict';

const g = (typeof global !== 'undefined' && global.crypto) ? global.crypto
  : (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto
  : (typeof crypto !== 'undefined' ? crypto : undefined);

if (!g || typeof g.getRandomValues !== 'function') {
  // Fail loud rather than silently handing yjs an insecure RNG.
  throw new Error(
    'lib0-webcrypto shim: global.crypto.getRandomValues is unavailable. ' +
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
