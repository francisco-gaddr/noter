/**
 * Pure helpers for the recent-notes list used by the dock menu (macOS) and
 * JumpList (Windows). Kept here so the validation/dedupe logic is unit-
 * testable without an Electron runtime.
 */

const MAX_ENTRIES = 5;
const MAX_TITLE_LEN = 64;
const MAX_ID_LEN = 64;

const isValidId = (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LEN && /^[A-Za-z0-9._:-]+$/.test(id);
const sanitiseTitle = (t) => {
  if (typeof t !== 'string') return 'Untitled';
  // Strip control chars (no \n in menu labels) and clamp length.
  const stripped = t.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!stripped) return 'Untitled';
  return stripped.length > MAX_TITLE_LEN ? `${stripped.slice(0, MAX_TITLE_LEN - 1)}…` : stripped;
};

/**
 * Push a note to the front of the recent list. Returns a NEW list (functional)
 * with at most MAX_ENTRIES items and no duplicate ids.
 */
const pushRecent = (existing, entry) => {
  if (!entry || !isValidId(entry.id)) return Array.isArray(existing) ? existing.slice(0, MAX_ENTRIES) : [];
  const next = { id: entry.id, title: sanitiseTitle(entry.title) };
  const filtered = (Array.isArray(existing) ? existing : []).filter((e) => isValidId(e?.id) && e.id !== next.id);
  return [next, ...filtered].slice(0, MAX_ENTRIES);
};

/**
 * Filter a stored list down to entries that still validate. Settings on disk
 * can drift / be hand-edited; we never trust it blindly.
 */
const sanitiseList = (existing) => {
  if (!Array.isArray(existing)) return [];
  const seen = new Set();
  const out = [];
  for (const e of existing) {
    if (!e || !isValidId(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, title: sanitiseTitle(e.title) });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
};

/**
 * Build the Electron Menu template for the dock/jumplist. `onOpen` receives
 * the id of the clicked entry.
 */
const buildRecentMenuTemplate = (list, { onOpen }) => {
  const safe = sanitiseList(list);
  if (safe.length === 0) {
    return [{ label: 'No recent notes', enabled: false }];
  }
  return safe.map((e) => ({
    label: e.title,
    click: () => onOpen && onOpen(e.id),
  }));
};

module.exports = {
  pushRecent,
  sanitiseList,
  buildRecentMenuTemplate,
  MAX_ENTRIES,
  MAX_TITLE_LEN,
  MAX_ID_LEN,
};
