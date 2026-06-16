/**
 * Nextcloud Login Flow v2 — pure protocol helpers (no IO). Lets the user authenticate by
 * granting an app-password in their browser instead of typing one, the recommended 2026
 * approach. The platform service drives the actual fetch + browser-open + poll loop with
 * these helpers; everything here is deterministic and unit-tested. ES5-safe.
 *
 * Flow (https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/):
 *   1. POST <host>/index.php/login/v2            → { poll:{token,endpoint}, login:<browser-url> }
 *   2. open `login` in a browser; the user logs in + grants access
 *   3. POST poll.endpoint  body `token=<poll.token>`  → 404 while pending, then
 *      200 { server, loginName, appPassword }
 */

const stripTrailingSlashes = (s: string): string => (s || '').replace(/\/+$/, '');

/** Normalize a host into the Login Flow v2 init URL (https enforced by the caller). */
export const buildLoginFlowInitUrl = (host: string): string => {
  let h = (host || '').trim();
  if (!h) return '';
  if (h.indexOf('://') === -1) h = 'https://' + h;
  // If a full dav/files path was pasted, reduce to the origin.
  h = h.replace(/\/remote\.php\/.*$/i, '');
  return stripTrailingSlashes(h) + '/index.php/login/v2';
};

export interface LoginFlowInit {
  pollToken: string;
  pollEndpoint: string;
  loginUrl: string;
}

/** Parse the init response. Returns null if the shape is unexpected. */
export const parseLoginFlowInit = (raw: unknown): LoginFlowInit | null => {
  let o: any = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== 'object') return null;
  const token = o.poll && o.poll.token;
  const endpoint = o.poll && o.poll.endpoint;
  const loginUrl = o.login;
  if (typeof token !== 'string' || typeof endpoint !== 'string' || typeof loginUrl !== 'string') return null;
  return { pollToken: token, pollEndpoint: endpoint, loginUrl };
};

/** The url-encoded form body for a poll request. */
export const loginFlowPollBody = (pollToken: string): string => 'token=' + encodeURIComponent(pollToken || '');

export interface LoginFlowResult {
  server: string;
  loginName: string;
  appPassword: string;
}

/** Parse the poll success response. Returns null while pending / on unexpected shape. */
export const parseLoginFlowResult = (raw: unknown): LoginFlowResult | null => {
  let o: any = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== 'object') return null;
  if (typeof o.server !== 'string' || typeof o.loginName !== 'string' || typeof o.appPassword !== 'string') return null;
  return { server: o.server, loginName: o.loginName, appPassword: o.appPassword };
};

/** Build the WebDAV files base URL from a Login Flow result (server + loginName). */
export const baseUrlFromLoginResult = (r: LoginFlowResult): string =>
  stripTrailingSlashes(r.server) + '/remote.php/dav/files/' + encodeURIComponent(r.loginName) + '/';
