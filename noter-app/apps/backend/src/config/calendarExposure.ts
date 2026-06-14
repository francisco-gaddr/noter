/**
 * Calendar/task EGRESS controls — the operator's master switches for the only two
 * paths by which (opt-in, lock-aware) plaintext task data can leave the server.
 * Everything else about notes/tasks stays end-to-end encrypted and is unreachable by
 * the backend regardless of these flags.
 *
 *   CALENDAR_ICS_ENABLED    (default on)  — the public read-only ICS feed (token-in-URL)
 *   CALENDAR_CALDAV_ENABLED (default on)  — the CalDAV bridge (/dav, Basic-Auth, two-way)
 *
 * Set either to "0" / "false" / "off" to HARD-disable that channel process-wide:
 * minting is refused (403) and the serving endpoints stop responding (404). Existing
 * stored feeds are untouched (so a re-enable is instant) but are no longer served, and
 * revoke still works so you can clean up while a channel is disabled. See
 * Doc/security/calendar-exposure.md.
 */

const isOff = (v: string | undefined): boolean => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'off' || s === 'no';
};

/** Public ICS feed (GET /api/calendar/:token.ics) + its create/push endpoints. */
export const isIcsEnabled = (): boolean => !isOff(process.env.CALENDAR_ICS_ENABLED);

/** CalDAV bridge (/dav) + its credential-mint endpoint. */
export const isCaldavEnabled = (): boolean => !isOff(process.env.CALENDAR_CALDAV_ENABLED);

/** Snapshot for /api/health surfacing + audit. */
export const calendarExposureStatus = () => ({
  ics: isIcsEnabled(),
  caldav: isCaldavEnabled(),
});
