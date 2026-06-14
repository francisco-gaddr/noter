/**
 * External base path for the CalDAV bridge. We serve it under `/api/dav` by default
 * because the public edge proxy already routes `/api/*` straight to this backend
 * (WebDAV verbs included) — whereas a bare `/dav` would need a separate edge rule.
 * All client-facing hrefs/URLs and the router mount use this single value, so the
 * paths a CalDAV client follows always match what the edge actually forwards.
 *
 * Override with DAV_BASE_PATH if a deployment fronts the backend differently.
 */
export const DAV_BASE = (process.env.DAV_BASE_PATH || '/api/dav').replace(/\/+$/, '');
