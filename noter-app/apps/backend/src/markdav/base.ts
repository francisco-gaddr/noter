/**
 * External base path for the Markdown WebDAV vault. Served under `/api/md` by default
 * because the public edge proxy already routes `/api/*` to this backend (WebDAV verbs
 * included). All client-facing hrefs/URLs and the router mount use this single value.
 * Override with MD_DAV_BASE_PATH if a deployment fronts the backend differently.
 */
export const MD_DAV_BASE = (process.env.MD_DAV_BASE_PATH || '/api/md').replace(/\/+$/, '');
