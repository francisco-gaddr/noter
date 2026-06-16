/**
 * External Markdown sync EGRESS controls — the operator master switches for the
 * Markdown channel (the note/files twin of the calendar channels). Everything about
 * notes stays end-to-end encrypted and unreachable by the backend regardless of these
 * flags; the only plaintext that exists server-side is the opt-in, lock-aware projection
 * the user explicitly enabled per share.
 *
 *   MARKDOWN_SYNC_ENABLED  (default on)  — the WebDAV vault (/api/md, Basic-Auth, two-way)
 *   MARKDOWN_CRDT_ENABLED  (default on)  — the CRDT "Live" server (Phase 2)
 *
 * Set either to "0" / "false" / "off" to HARD-disable that channel process-wide: minting
 * is refused (403) and the serving endpoints stop responding (404). Existing stored shares
 * are untouched (instant re-enable) but no longer served; revoke still works. See
 * Doc/security/calendar-exposure.md.
 */

const isOff = (v: string | undefined): boolean => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'off' || s === 'no';
};

/** WebDAV Markdown vault (/api/md) + its credential-mint endpoint. */
export const isMarkdownSyncEnabled = (): boolean => !isOff(process.env.MARKDOWN_SYNC_ENABLED);

/** CRDT "Live" server (Phase 2). */
export const isMarkdownCrdtEnabled = (): boolean => !isOff(process.env.MARKDOWN_CRDT_ENABLED);

/** Snapshot for /api/health surfacing + audit. */
export const markdownExposureStatus = () => ({
  webdav: isMarkdownSyncEnabled(),
  crdt: isMarkdownCrdtEnabled(),
});
