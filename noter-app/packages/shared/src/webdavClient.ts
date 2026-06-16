/**
 * Dependency-free WebDAV client core (pure parsing + URL/scoping helpers) for INBOUND
 * ingestion of an external WebDAV source — primarily a self-hosted Nextcloud. The app has
 * always been a DAV *server* (projecting our own notes out via markdav/CalDAV); this is the
 * inverse: a *client* that pulls selected folders in.
 *
 * This module is intentionally IO-free: it builds the PROPFIND request body and parses the
 * multistatus XML response into a flat list of entries. The actual network fetch is injected
 * by the platform service (web fetch / RN fetch) so this stays unit-testable and runs
 * identically on every platform. ES5-safe (no regex `u`-flag / `\p{}` — that breaks the
 * shared tsc build).
 *
 * Security: callers MUST enforce TLS (`enforceHttps`) and scope every PROPFIND under the
 * user-selected root paths (`isUnderRoots`). Credentials are never stored here — the service
 * holds them encrypted on-device and passes an auth header to its injected fetch.
 */

/** A connection to one external WebDAV server (e.g. a Nextcloud account). */
export interface WebdavConnection {
  id: string;
  name: string;
  /** Normalized DAV files root, e.g. https://cloud.example.com/remote.php/dav/files/alice/ */
  baseUrl: string;
  /** Non-secret login name (Nextcloud username). The app-password lives in secure storage. */
  username: string;
  /** User-selected root folders to ingest (relative to baseUrl), e.g. ['Research', 'Notes']. */
  rootPaths: string[];
  /** Auto-sync interval in minutes (0 = manual only). */
  intervalMinutes?: number;
  createdAt?: string;
}

/** One file or collection (folder) discovered via PROPFIND. */
export interface WebdavEntry {
  /** Path relative to the connection baseUrl, POSIX, no leading slash (e.g. 'Research/x.pdf'). */
  path: string;
  /** Display name (last path segment). */
  name: string;
  isCollection: boolean;
  etag: string;
  size: number;
  contentType: string;
  lastModified: string;
}

export type IngestFileKind = 'text' | 'pdf' | 'image' | 'skip';

/** Extension allowlist → how the file is turned into note text. */
const TEXT_EXT = [
  'md', 'markdown', 'txt', 'text', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml',
  'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs',
  'sh', 'sql', 'html', 'css', 'xml', 'toml', 'ini', 'org', 'rst',
];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'tiff'];

const extOf = (name: string): string => {
  const i = (name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
};

/** Classify a file by name/MIME into how (or whether) it gets ingested. */
export const classifyFile = (name: string, mimeType?: string): IngestFileKind => {
  const ext = extOf(name);
  const mime = (mimeType || '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (IMAGE_EXT.indexOf(ext) !== -1 || mime.indexOf('image/') === 0) return 'image';
  if (TEXT_EXT.indexOf(ext) !== -1 || mime.indexOf('text/') === 0) return 'text';
  // Some text-ish MIME types that don't start with text/.
  if (mime === 'application/json' || mime === 'application/xml') return 'text';
  return 'skip';
};

/**
 * Build a Nextcloud (or generic WebDAV) files root URL from a host + username.
 * `host` may be a bare domain or a full origin; trailing slashes are tolerated.
 */
export const normalizeNextcloudBaseUrl = (host: string, username: string): string => {
  let h = (host || '').trim();
  if (!h) return '';
  if (h.indexOf('://') === -1) h = 'https://' + h;
  h = h.replace(/\/+$/, '');
  // If the caller already passed a full dav path, keep it; else append the standard one.
  if (/\/remote\.php\/dav\/files\//i.test(h)) return h.replace(/\/+$/, '') + '/';
  return h + '/remote.php/dav/files/' + encodeURIComponent(username) + '/';
};

/** Throw unless the URL is https (or an explicit localhost/LAN http for dev). */
export const enforceHttps = (url: string): void => {
  const u = (url || '').toLowerCase();
  if (u.indexOf('https://') === 0) return;
  if (
    u.indexOf('http://localhost') === 0 ||
    u.indexOf('http://127.0.0.1') === 0 ||
    /^http:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u)
  ) return;
  throw new Error('Osäker anslutning: WebDAV-värden måste använda https (TLS).');
};

/** Percent-encode each segment of a path while keeping the slashes. */
export const encodeDavPath = (path: string): string =>
  (path || '').split('/').map((s) => (s ? encodeURIComponent(s) : s)).join('/');

/** Join a baseUrl (ends with /) and a relative path into an absolute, encoded DAV URL. */
export const joinDavUrl = (baseUrl: string, relPath: string): string => {
  const base = (baseUrl || '').replace(/\/+$/, '');
  const rel = (relPath || '').replace(/^\/+/, '');
  return rel ? base + '/' + encodeDavPath(rel) : base + '/';
};

/** True if `path` is the same as, or nested under, any of the selected root paths. */
export const isUnderRoots = (path: string, roots: string[]): boolean => {
  const p = normalizePath(path);
  if (!roots || roots.length === 0) return false;
  for (const r0 of roots) {
    const r = normalizePath(r0);
    if (r === '' ) return true;
    if (p === r || p.indexOf(r + '/') === 0) return true;
  }
  return false;
};

/** Strip leading/trailing slashes and collapse repeats. */
export const normalizePath = (path: string): string =>
  (path || '').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');

// ---- PROPFIND ----------------------------------------------------------------

/** The request body for a Depth-1 PROPFIND fetching the props we need. */
export const buildPropfindBody = (): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop>' +
  '<d:resourcetype/><d:getetag/><d:getcontentlength/>' +
  '<d:getcontenttype/><d:getlastmodified/><d:displayname/>' +
  '</d:prop></d:propfind>';

// Match an inner-tag value regardless of namespace prefix (d:, D:, lp1:, …). No `u`-flag.
const innerTag = (block: string, local: string): string => {
  const re = new RegExp('<[a-z0-9]+:' + local + '[^>]*>([\\s\\S]*?)</[a-z0-9]+:' + local + '>', 'i');
  const m = re.exec(block);
  if (m) return decodeXml(m[1].trim());
  // Self-closing or namespaced-without-prefix fallback.
  const re2 = new RegExp('<' + local + '[^>]*>([\\s\\S]*?)</' + local + '>', 'i');
  const m2 = re2.exec(block);
  return m2 ? decodeXml(m2[1].trim()) : '';
};

const decodeXml = (s: string): string =>
  (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const splitResponses = (xml: string): string[] => {
  const out: string[] = [];
  const re = /<[a-z0-9]+:response[^>]*>([\s\S]*?)<\/[a-z0-9]+:response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml || ''))) out.push(m[1]);
  return out;
};

/** Decode a percent-encoded href into a plain string. Tolerant of bad input. */
const safeDecodeUri = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; }
};

/**
 * Parse a PROPFIND multistatus XML response into entries with paths RELATIVE to `baseUrl`.
 * The collection corresponding to the request URL itself is dropped (only its children are
 * returned). Robust to namespace-prefix variation; tolerant of partial props.
 */
export const parsePropfindXml = (xml: string, baseUrl: string): WebdavEntry[] => {
  const basePath = davPathname(baseUrl);
  const entries: WebdavEntry[] = [];
  for (const block of splitResponses(xml)) {
    const hrefRaw = innerTag(block, 'href');
    if (!hrefRaw) continue;
    const hrefPath = safeDecodeUri(davPathname(hrefRaw));
    let rel = hrefPath;
    if (basePath && (rel === basePath || rel.indexOf(basePath) === 0)) {
      rel = rel.slice(basePath.length);
    }
    rel = normalizePath(rel);
    if (rel === '') continue; // the requested collection itself

    const resourcetype = innerTag(block, 'resourcetype');
    const isCollection = /<[a-z0-9]*:?collection/i.test(resourcetype) || /collection/i.test(resourcetype);
    const name = rel.split('/').pop() || rel;
    entries.push({
      path: rel,
      name,
      isCollection,
      etag: stripQuotes(innerTag(block, 'getetag')),
      size: parseInt(innerTag(block, 'getcontentlength') || '0', 10) || 0,
      contentType: innerTag(block, 'getcontenttype'),
      lastModified: innerTag(block, 'getlastmodified'),
    });
  }
  return entries;
};

const stripQuotes = (s: string): string => (s || '').replace(/^W\//i, '').replace(/^"+|"+$/g, '');

/** Extract just the pathname from a URL or an already-path href. */
export const davPathname = (urlOrPath: string): string => {
  const s = urlOrPath || '';
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/[^?#]*)/i.exec(s);
  if (m) return m[1];
  // already a path
  const q = s.indexOf('?');
  return q >= 0 ? s.slice(0, q) : s;
};
