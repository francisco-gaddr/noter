import {
  generateVtodoResource,
  generateVtodoCalendar,
  vtodoLines,
  parseVtodo,
  parseIcsDate,
  foldLine,
  icsEscapeText,
  icsUnescapeText,
  itemEtag,
} from './caldav';
import { taskPriorityToRfc, rfcPriorityToTask, buildCalendarProjection } from './calendar';
import type { CalendarFeedItem } from './calendar';
import type { Task } from './types';

const now = new Date('2026-06-14T10:00:00.000Z');
const item = (over: Partial<CalendarFeedItem>): CalendarFeedItem => ({
  uid: 'u1', title: 'Task', start: '2026-07-01T13:30:00.000Z', allDay: false, completed: false, ...over,
});

describe('priority mapping', () => {
  it('maps task priority to RFC and back', () => {
    expect(taskPriorityToRfc('high')).toBe(1);
    expect(taskPriorityToRfc('medium')).toBe(5);
    expect(taskPriorityToRfc('low')).toBe(9);
    expect(taskPriorityToRfc('')).toBe(0);
    expect(rfcPriorityToTask(1)).toBe('high');
    expect(rfcPriorityToTask(5)).toBe('medium');
    expect(rfcPriorityToTask(9)).toBe('low');
    expect(rfcPriorityToTask(0)).toBeNull();
  });
});

describe('projection carries description + priority', () => {
  it('includes description and rfc priority for dated tasks', () => {
    const t = {
      _id: 'a', userId: 'u', title: 'Do it', completed: false, createdAt: '', updatedAt: '',
      dueDate: '2026-07-01T13:30:00.000Z', description: 'notes here', priority: 'high',
    } as unknown as Task;
    const [proj] = buildCalendarProjection([t]);
    expect(proj.description).toBe('notes here');
    expect(proj.priority).toBe(1);
  });
});

describe('generateVtodoResource', () => {
  it('produces a VCALENDAR with one VTODO and CRLF', () => {
    const ics = generateVtodoResource(item({ description: 'do, it', priority: 1 }), { now });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('UID:u1');
    expect(ics).toContain('SUMMARY:Task');
    expect(ics).toContain('DESCRIPTION:do\\, it');
    expect(ics).toContain('DUE:20260701T133000Z');
    expect(ics).toContain('PRIORITY:1');
    expect(ics).toContain('STATUS:NEEDS-ACTION');
  });

  it('emits all-day DUE as VALUE=DATE', () => {
    const ics = generateVtodoResource(item({ allDay: true, start: '2026-07-02T00:00:00.000Z' }), { now });
    expect(ics).toContain('DUE;VALUE=DATE:20260702');
  });

  it('marks completed todos with STATUS + COMPLETED + PERCENT-COMPLETE', () => {
    const ics = generateVtodoResource(item({ completed: true }), { now });
    expect(ics).toContain('STATUS:COMPLETED');
    expect(ics).toContain('PERCENT-COMPLETE:100');
    expect(ics).toContain('COMPLETED:20260614T100000Z');
  });
});

describe('generateVtodoCalendar', () => {
  it('renders N VTODOs and a calendar name', () => {
    const ics = generateVtodoCalendar([item({ uid: 'a' }), item({ uid: 'b' })], { now, calName: 'Jobb' });
    expect((ics.match(/BEGIN:VTODO/g) || []).length).toBe(2);
    expect(ics).toContain('X-WR-CALNAME:Jobb');
    expect(ics).toContain('UID:a');
    expect(ics).toContain('UID:b');
  });

  it('skips items without a uid', () => {
    const ics = generateVtodoCalendar([item({ uid: '' }), item({ uid: 'ok' })], { now });
    expect((ics.match(/BEGIN:VTODO/g) || []).length).toBe(1);
  });
});

describe('foldLine', () => {
  it('does not fold short lines', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });
  it('folds long lines at <=75 octets with CRLF + space', () => {
    const long = 'DESCRIPTION:' + 'x'.repeat(200);
    const folded = foldLine(long);
    expect(folded).toContain('\r\n ');
    for (const seg of folded.split('\r\n ')) {
      expect(Buffer.byteLength(seg, 'utf8')).toBeLessThanOrEqual(75);
    }
  });
  it('never splits a multibyte char', () => {
    const long = 'DESCRIPTION:' + 'ä'.repeat(80);
    const folded = foldLine(long);
    // Re-joining the unfolded segments must reproduce the original text.
    expect(folded.split('\r\n ').join('')).toBe(long);
  });
});

describe('escape round-trip', () => {
  it('escapes and unescapes text losslessly', () => {
    const s = 'a, b; c\\ d\ne';
    expect(icsUnescapeText(icsEscapeText(s))).toBe(s);
  });
});

describe('parseIcsDate', () => {
  it('parses DATE, UTC DATE-TIME, and floating', () => {
    expect(parseIcsDate('20260701')).toBe('2026-07-01T00:00:00.000Z');
    expect(parseIcsDate('20260701T133000Z')).toBe('2026-07-01T13:30:00.000Z');
    expect(parseIcsDate('20260701T133000')).toBe('2026-07-01T13:30:00.000Z');
    expect(parseIcsDate('nonsense')).toBeNull();
  });
});

describe('parseVtodo', () => {
  const wrap = (body: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\n${body}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

  it('extracts uid, summary, due, priority', () => {
    const p = parseVtodo(wrap('UID:abc\r\nSUMMARY:Hello\r\nDUE:20260701T133000Z\r\nPRIORITY:1'));
    expect(p?.uid).toBe('abc');
    expect(p?.summary).toBe('Hello');
    expect(p?.due).toBe('2026-07-01T13:30:00.000Z');
    expect(p?.priority).toBe(1);
    expect(p?.completed).toBe(false);
  });

  it('detects completion via STATUS:COMPLETED', () => {
    const p = parseVtodo(wrap('UID:x\r\nSTATUS:COMPLETED\r\nCOMPLETED:20260614T100000Z'));
    expect(p?.completed).toBe(true);
    expect(p?.completedAt).toBe('2026-06-14T10:00:00.000Z');
  });

  it('detects completion via PERCENT-COMPLETE:100', () => {
    const p = parseVtodo(wrap('UID:x\r\nPERCENT-COMPLETE:100'));
    expect(p?.completed).toBe(true);
  });

  it('treats NEEDS-ACTION as not completed', () => {
    const p = parseVtodo(wrap('UID:x\r\nSTATUS:NEEDS-ACTION'));
    expect(p?.completed).toBe(false);
  });

  it('unfolds folded lines and unescapes text', () => {
    const folded = wrap('UID:x\r\nSUMMARY:Long line that is\r\n  continued here\r\nDESCRIPTION:a\\, b');
    const p = parseVtodo(folded);
    expect(p?.summary).toBe('Long line that is continued here');
    expect(p?.description).toBe('a, b');
  });

  it('handles params on DUE (VALUE=DATE)', () => {
    const p = parseVtodo(wrap('UID:x\r\nDUE;VALUE=DATE:20260702'));
    expect(p?.due).toBe('2026-07-02T00:00:00.000Z');
  });

  it('returns null when there is no VTODO', () => {
    expect(parseVtodo('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBeNull();
  });

  it('round-trips a generated todo back to the same intent', () => {
    const ics = generateVtodoResource(item({ uid: 'rt', completed: true, priority: 5, description: 'd' }), { now });
    const p = parseVtodo(ics);
    expect(p?.uid).toBe('rt');
    expect(p?.completed).toBe(true);
    expect(p?.priority).toBe(5);
    expect(p?.description).toBe('d');
  });
});

describe('itemEtag', () => {
  it('is stable for the same state and changes when completion flips', () => {
    const a = itemEtag(item({ completed: false }));
    const b = itemEtag(item({ completed: false }));
    const c = itemEtag(item({ completed: true }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
