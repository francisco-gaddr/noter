/**
 * Parser for the custom `noter://` protocol.
 *
 * Supported routes:
 *   noter://note/<noteId>             → /note/<noteId>
 *   noter://task/<taskId>             → /task/<taskId>
 *   noter://open?route=<encoded-path> → arbitrary internal route
 *
 * Pure function — no Electron deps so it's testable.
 *
 * Returns null for anything we don't trust (foreign protocol, malformed id,
 * path traversal). The caller (main.js) treats null as "ignore this argv
 * entirely" so we never route the user to attacker-controlled content.
 */

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ROUTE_PATTERN = /^\/[A-Za-z0-9._:/?&=%-]{0,512}$/;

const parseDeeplink = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'noter:') return null;

  // Host carries the resource type for the canonical forms.
  const host = url.hostname; // 'note' / 'task' / 'open'
  // pathname starts with '/' if there's a path component; we strip it.
  const segment = url.pathname.replace(/^\//, '').split('/')[0] || '';

  if (host === 'note' || host === 'task') {
    if (!ID_PATTERN.test(segment)) return null;
    return { type: host, id: segment, route: `/${host}/${segment}` };
  }

  if (host === 'open') {
    const route = url.searchParams.get('route');
    if (!route) return null;
    if (!ROUTE_PATTERN.test(route)) return null;
    // Disallow protocol-relative or absolute-with-host (we already know the
    // protocol is noter: but defence-in-depth: never accept anything that
    // could reach outside our SPA's own routing).
    if (route.startsWith('//') || /^https?:/i.test(route)) return null;
    return { type: 'open', route };
  }

  return null;
};

/**
 * Walk argv looking for a noter:// link (Windows passes deep-links as an
 * argv entry; macOS uses an `open-url` event). Returns the first valid one
 * or null.
 */
const findDeeplinkInArgv = (argv) => {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    if (!arg.startsWith('noter://')) continue;
    const parsed = parseDeeplink(arg);
    if (parsed) return parsed;
  }
  return null;
};

module.exports = { parseDeeplink, findDeeplinkInArgv };
