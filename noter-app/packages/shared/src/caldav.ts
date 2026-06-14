/**
 * CalDAV / iCalendar VTODO helpers — the task (to-do) counterpart to calendar.ts
 * (which handles VEVENT for the read-only ICS feed). Used by the backend CalDAV
 * bridge to render the user's pushed plaintext projection as VTODO resources, and
 * to parse incoming PUT bodies from CalDAV clients (Tasks.org, Apple Reminders) into
 * a minimal, safe mutation intent.
 *
 * Pure + dependency-free (runs in RN/web/Node, fully unit-testable). Task titles +
 * due dates are E2E-encrypted at rest, so the backend never sees plaintext tasks —
 * it only ever renders the client-pushed projection (CalendarFeedItem) and, on write,
 * records a non-sensitive mutation intent (uid + op) for the client to apply with the
 * user's key. Nothing here touches ciphertext.
 */
import type { CalendarFeedItem } from './calendar';

// --- text + date primitives (RFC 5545) -------------------------------------

/** Escape a TEXT value per RFC 5545 §3.3.11. */
export const icsEscapeText = (s: string): string =>
  String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** Unescape a TEXT value per RFC 5545 §3.3.11. */
export const icsUnescapeText = (s: string): string => {
  let out = '';
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\\' && i + 1 < str.length) {
      const n = str[i + 1];
      if (n === 'n' || n === 'N') { out += '\n'; i++; continue; }
      if (n === '\\' || n === ';' || n === ',') { out += n; i++; continue; }
    }
    out += c;
  }
  return out;
};

const pad = (n: number): string => String(n).padStart(2, '0');
const dateVal = (d: Date): string => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const dateTimeVal = (d: Date): string =>
  `${dateVal(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/**
 * Parse an iCalendar DATE or DATE-TIME value into an ISO string (or null).
 * Handles `20260701` (date), `20260701T133000Z` (UTC), `20260701T133000` (floating —
 * interpreted as UTC, matching how the all-day projection is anchored).
 */
export const parseIcsDate = (raw: string): string | null => {
  const v = String(raw || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** UTF-8 byte length of a single code point (no Buffer dependency — RN-safe). */
const utf8Len = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

/**
 * Fold a content line to ≤75 octets per RFC 5545 §3.1 (CRLF + single space
 * continuation). Folding is code-point aware so multibyte UTF-8 chars are never
 * split, and uses no Buffer so it stays portable across RN/web/Node.
 */
export const foldLine = (line: string): string => {
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  // Iterate by code point so surrogate pairs (emoji etc.) stay intact.
  for (const ch of String(line)) {
    const cost = utf8Len(ch.codePointAt(0) || 0);
    if (bytes + cost > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // continuation lines carry a leading space → 1 fewer octet
    }
    cur += ch;
    bytes += cost;
  }
  if (cur || parts.length === 0) parts.push(cur);
  return parts.join('\r\n ');
};

const joinIcs = (lines: string[]): string => lines.map(foldLine).join('\r\n') + '\r\n';

// --- VTODO generation ------------------------------------------------------

export interface VtodoOptions {
  /** Injectable "now" for deterministic DTSTAMP/COMPLETED in tests. */
  now?: Date;
  /** Calendar display name (X-WR-CALNAME). */
  calName?: string;
}

/**
 * Render one projection item's VTODO body lines (without BEGIN/END:VCALENDAR).
 * `etagBase` lets the caller derive a stable resource id; UID is the item uid.
 */
export const vtodoLines = (item: CalendarFeedItem, opts: VtodoOptions = {}): string[] => {
  const now = opts.now || new Date();
  const stamp = dateTimeVal(now);
  const lines: string[] = ['BEGIN:VTODO', `UID:${icsEscapeText(item.uid)}`, `DTSTAMP:${stamp}`];
  lines.push(`SUMMARY:${icsEscapeText(item.title || 'Uppgift')}`);
  if (item.description) lines.push(`DESCRIPTION:${icsEscapeText(item.description)}`);
  const due = item.start ? new Date(item.start) : null;
  if (due && !Number.isNaN(due.getTime())) {
    if (item.allDay) lines.push(`DUE;VALUE=DATE:${dateVal(due)}`);
    else lines.push(`DUE:${dateTimeVal(due)}`);
  }
  if (typeof item.priority === 'number' && item.priority > 0) {
    lines.push(`PRIORITY:${Math.max(1, Math.min(9, Math.round(item.priority)))}`);
  }
  if (item.completed) {
    lines.push('STATUS:COMPLETED');
    lines.push('PERCENT-COMPLETE:100');
    lines.push(`COMPLETED:${stamp}`);
  } else {
    lines.push('STATUS:NEEDS-ACTION');
  }
  lines.push('END:VTODO');
  return lines;
};

/** Wrap a single VTODO item in a complete VCALENDAR (one resource = one .ics). */
export const generateVtodoResource = (item: CalendarFeedItem, opts: VtodoOptions = {}): string =>
  joinIcs([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Noter//Tasks//SV',
    'CALSCALE:GREGORIAN',
    ...vtodoLines(item, opts),
    'END:VCALENDAR',
  ]);

/** Render a whole collection of items as one VCALENDAR with N VTODOs. */
export const generateVtodoCalendar = (items: CalendarFeedItem[], opts: VtodoOptions = {}): string => {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Noter//Tasks//SV',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscapeText(opts.calName || 'Noter – Uppgifter')}`,
  ];
  for (const it of items || []) {
    if (!it || !it.uid) continue;
    lines.push(...vtodoLines(it, opts));
  }
  lines.push('END:VCALENDAR');
  return joinIcs(lines);
};

/**
 * A weak ETag derived from the item's mutable fields. Two renders of the same
 * logical state produce the same ETag (DTSTAMP/COMPLETED-now are excluded). Used so
 * CalDAV clients can detect changes via If-Match / getetag.
 */
export const itemEtag = (item: CalendarFeedItem): string => {
  const basis = JSON.stringify([
    item.uid,
    item.title || '',
    item.start || '',
    !!item.allDay,
    !!item.completed,
    item.description || '',
    item.priority || 0,
  ]);
  // djb2 — small, stable, no crypto dep needed for an opaque change token.
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) >>> 0;
  return `"${h.toString(16)}"`;
};

// --- VTODO parsing (incoming PUT) ------------------------------------------

export interface ParsedVtodo {
  uid: string | null;
  summary: string | null;
  description: string | null;
  /** ISO due date, or null. */
  due: string | null;
  completed: boolean;
  /** ISO completion timestamp if present. */
  completedAt: string | null;
  /** RFC priority 0–9 (0 = unset). */
  priority: number;
  status: string | null;
}

/** Unfold RFC 5545 content lines (CRLF/LF + space|tab continuation → single line). */
const unfold = (text: string): string[] => {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
};

/** Split a content line into { name, params, value }. NAME(;PARAM=v)*:VALUE */
const splitProp = (line: string): { name: string; params: string; value: string } | null => {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = head.indexOf(';');
  const name = (semi === -1 ? head : head.slice(0, semi)).trim().toUpperCase();
  const params = semi === -1 ? '' : head.slice(semi + 1).toUpperCase();
  if (!name) return null;
  return { name, params, value };
};

/**
 * Parse the FIRST VTODO in an iCalendar body into a minimal normalized intent.
 * Tolerant of vendor quirks; only the fields we map are extracted. Returns null if
 * there is no VTODO at all.
 */
export const parseVtodo = (text: string): ParsedVtodo | null => {
  const lines = unfold(text);
  let inTodo = false;
  let seen = false;
  const out: ParsedVtodo = {
    uid: null, summary: null, description: null, due: null,
    completed: false, completedAt: null, priority: 0, status: null,
  };
  for (const line of lines) {
    const up = line.trim().toUpperCase();
    if (up === 'BEGIN:VTODO') { inTodo = true; seen = true; continue; }
    if (up === 'END:VTODO') break;
    if (!inTodo) continue;
    const p = splitProp(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': out.uid = p.value.trim() || null; break;
      case 'SUMMARY': out.summary = icsUnescapeText(p.value); break;
      case 'DESCRIPTION': out.description = icsUnescapeText(p.value); break;
      case 'DUE':
      case 'DTSTART': if (!out.due) out.due = parseIcsDate(p.value); break;
      case 'STATUS': out.status = p.value.trim().toUpperCase() || null; break;
      case 'COMPLETED': out.completedAt = parseIcsDate(p.value); break;
      case 'PERCENT-COMPLETE': {
        const n = parseInt(p.value, 10);
        if (Number.isFinite(n) && n >= 100) out.completed = true;
        break;
      }
      case 'PRIORITY': {
        const n = parseInt(p.value, 10);
        if (Number.isFinite(n)) out.priority = Math.max(0, Math.min(9, n));
        break;
      }
      default: break;
    }
  }
  if (!seen) return null;
  // Completion is true if STATUS:COMPLETED, PERCENT-COMPLETE>=100, or a COMPLETED stamp.
  if (out.status === 'COMPLETED' || out.completedAt) out.completed = true;
  if (out.status === 'NEEDS-ACTION' || out.status === 'IN-PROCESS') {
    if (!out.completedAt) out.completed = false;
  }
  return out;
};
