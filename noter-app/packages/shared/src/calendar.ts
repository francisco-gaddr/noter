/**
 * Calendar (iCalendar / ICS) subscription helpers — shared by the backend feed and
 * all clients. Task titles + due dates are E2E-encrypted at rest, so the backend
 * can't build an ICS itself; the client builds a minimal plaintext projection
 * (buildCalendarProjection) and pushes it, and the public ICS endpoint serves it
 * via generateIcs. Pure, dependency-free, testable.
 */
import type { Task } from './types';
import { buildSecurityNoteMap, isReadableWithLocks, type SecurityNote } from './locks';

export interface CalendarFeedItem {
  uid: string;
  title: string;
  /** ISO date/datetime. */
  start: string;
  /** All-day event (no meaningful time-of-day). */
  allDay: boolean;
  completed: boolean;
  /** Optional plaintext description/notes (VTODO DESCRIPTION). Opt-in, lock-aware. */
  description?: string;
  /** RFC 5545 VTODO PRIORITY 0–9 (0/absent = none, 1 = highest … 9 = lowest). */
  priority?: number;
}

/** Map our task priority ('low'|'medium'|'high') to an RFC 5545 PRIORITY number. */
export const taskPriorityToRfc = (p: unknown): number => {
  switch (String(p || '').toLowerCase()) {
    case 'high': return 1;
    case 'medium': return 5;
    case 'low': return 9;
    default: return 0;
  }
};

/** Map an RFC 5545 PRIORITY number back to our task priority, or null if unset. */
export const rfcPriorityToTask = (n: unknown): 'low' | 'medium' | 'high' | null => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v <= 4) return 'high';
  if (v === 5) return 'medium';
  return 'low';
};

/**
 * Project the user's tasks down to the minimal calendar fields. Only tasks with a
 * valid due date are included. All-day when the due time is midnight (date-only).
 */
export const buildCalendarProjection = (tasks: Task[]): CalendarFeedItem[] => {
  const out: CalendarFeedItem[] = [];
  for (const t of tasks || []) {
    if (!t || !t.dueDate || t.deleted) continue;
    const d = new Date(t.dueDate);
    if (Number.isNaN(d.getTime())) continue;
    const uid = String(t._id || t.clientId || '').trim();
    if (!uid) continue;
    // All-day when there's no meaningful local time-of-day. For all-day events we
    // anchor `start` to UTC-midnight of the LOCAL calendar date, so the ICS date
    // value (computed in UTC downstream) never drifts to the previous/next day in
    // another timezone. Timed events keep their exact UTC instant.
    const allDay = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
    const start = allDay
      ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString()
      : d.toISOString();
    const description = String((t as any).description || '').slice(0, 4000);
    const priority = taskPriorityToRfc((t as any).priority);
    out.push({
      uid,
      title: String(t.title || 'Uppgift').slice(0, 500),
      start,
      allDay,
      completed: !!t.completed,
      ...(description ? { description } : {}),
      ...(priority ? { priority } : {}),
    });
  }
  return out;
};

/**
 * Lock-aware projection: like buildCalendarProjection, but FIRST drops any task whose
 * parent note/list/project is locked-and-not-unlocked. This upholds the locked-notes
 * invariant — a locked task's title must never leak, not even into the user's own
 * calendar feed. Tasks with no parent container are always included. Missing/empty
 * unlockedIds → locked tasks are excluded (the safe default).
 *
 * `opts.listId` scopes the feed: when set, only tasks in that task-list/project (by
 * parentNoteId) are included — that's how a per-list calendar link works. Omit (or
 * null/'all') for the all-tasks feed.
 */
export const buildSafeCalendarProjection = (
  tasks: Task[],
  notes: SecurityNote[],
  unlockedIds: Iterable<string> = [],
  opts: { listId?: string | null } = {},
): CalendarFeedItem[] => {
  const noteMap = buildSecurityNoteMap(notes || []);
  const ids = unlockedIds instanceof Set ? unlockedIds : new Set(unlockedIds);
  const wantList = opts.listId && opts.listId !== 'all' ? String(opts.listId) : null;
  const safe = (tasks || []).filter((t) => {
    const parent = (t as any)?.parentNoteId;
    if (wantList && String(parent || '') !== wantList) return false;
    if (!parent) return true;
    return isReadableWithLocks(noteMap.get(String(parent)), noteMap, ids);
  });
  return buildCalendarProjection(safe);
};

const escapeText = (s: string): string =>
  (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

const pad = (n: number): string => String(n).padStart(2, '0');
const dateValue = (d: Date): string => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const dateTimeValue = (d: Date): string => `${dateValue(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/**
 * Build a valid RFC 5545 VCALENDAR string from projection items. `now` is injectable
 * so output is deterministic for tests (defaults to the current time).
 */
export const generateIcs = (
  items: CalendarFeedItem[],
  opts: { calName?: string; now?: Date } = {},
): string => {
  const calName = opts.calName || 'Noter – Uppgifter';
  const stamp = dateTimeValue(opts.now || new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Noter//Tasks//SV',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const it of items || []) {
    const d = new Date(it.start);
    if (Number.isNaN(d.getTime())) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(it.uid)}@noter`);
    lines.push(`DTSTAMP:${stamp}`);
    if (it.allDay) lines.push(`DTSTART;VALUE=DATE:${dateValue(d)}`);
    else lines.push(`DTSTART:${dateTimeValue(d)}`);
    lines.push(`SUMMARY:${escapeText((it.completed ? '✓ ' : '') + (it.title || 'Uppgift'))}`);
    lines.push(`STATUS:${it.completed ? 'COMPLETED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 requires CRLF line endings.
  return lines.join('\r\n') + '\r\n';
};
