import '@testing-library/jest-dom';

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});


// jsdom does not provide TextEncoder/TextDecoder, which @noble/hashes (v3 crypto)
// relies on. Real browsers have them natively; this only patches the test env.
const { TextEncoder, TextDecoder } = require('util');
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

// jsdom has no fetch. Screens fire best-effort background syncs (markdown/calendar
// mutation drains) on mount; without a stub those become loud ReferenceErrors that
// fail unrelated suites. Real code treats any network failure as a no-op, so an
// always-failing fetch is the faithful test-env equivalent.
if (typeof global.fetch === 'undefined') {
  global.fetch = jest.fn(async () => ({ ok: false, status: 0, json: async () => null, text: async () => '' }));
}
