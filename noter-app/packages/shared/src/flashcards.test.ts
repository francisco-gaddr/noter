import { buildFlashcardsPrompt, parseFlashcards, scheduleNext, isDue, newCardState } from './flashcards';

describe('buildFlashcardsPrompt', () => {
  it('asks for JSON cards, caps count + body, honours language', () => {
    const { system, prompt } = buildFlashcardsPrompt('T', 'x'.repeat(20000), { count: 50, language: 'sv' });
    expect(system).toContain('JSON array');
    expect(system).toContain('up to 20'); // clamped from 50
    expect(system).toContain('sv');
    expect(prompt.length).toBeLessThan(12100);
  });
});

describe('parseFlashcards', () => {
  it('parses a JSON array (even surrounded by prose / fences)', () => {
    const raw = 'Here you go:\n```json\n[{"front":"Capital of France?","back":"Paris"},{"q":"2+2","a":"4"}]\n```';
    expect(parseFlashcards(raw)).toEqual([
      { front: 'Capital of France?', back: 'Paris' },
      { front: '2+2', back: '4' },
    ]);
  });
  it('falls back to loose Q:/A: pairs', () => {
    expect(parseFlashcards('Q: What is X?\nA: It is Y\nQ: Empty answer\n')).toEqual([{ front: 'What is X?', back: 'It is Y' }]);
  });
  it('never throws on junk', () => {
    expect(parseFlashcards('')).toEqual([]);
    expect(parseFlashcards('no cards here')).toEqual([]);
  });
});

describe('scheduleNext (SM-2)', () => {
  const now = new Date('2026-06-20T00:00:00.000Z');
  it('"again" resets and reschedules within minutes', () => {
    const r = scheduleNext({ ease: 2.5, intervalDays: 10, reps: 3 }, 'again', now);
    expect(r.reps).toBe(0);
    expect(r.intervalDays).toBe(0);
    expect(new Date(r.due).getTime() - now.getTime()).toBeLessThan(20 * 60_000);
  });
  it('grows the interval on successive "good" reviews', () => {
    const a = scheduleNext(newCardState(now), 'good', now); // first review
    expect(a.intervalDays).toBe(1);
    const b = scheduleNext(a, 'good', now);
    expect(b.intervalDays).toBe(6);
    const c = scheduleNext(b, 'good', now);
    expect(c.intervalDays).toBeGreaterThan(6); // ~ interval * ease
  });
  it('"easy" raises ease + interval, "hard" lowers ease, floored at 1.3', () => {
    const easy = scheduleNext({ ease: 2.5, intervalDays: 10, reps: 3 }, 'easy', now);
    expect(easy.ease).toBeGreaterThan(2.5);
    const hard = scheduleNext({ ease: 1.35, intervalDays: 10, reps: 3 }, 'hard', now);
    expect(hard.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe('isDue', () => {
  const now = new Date('2026-06-20T12:00:00.000Z');
  it('true when due is in the past, false when future', () => {
    expect(isDue({ due: '2026-06-20T11:00:00.000Z' }, now)).toBe(true);
    expect(isDue({ due: '2026-06-21T00:00:00.000Z' }, now)).toBe(false);
  });
});

describe('isDue with corrupt dates', () => {
  it('treats an unparsable due date as DUE so the card is never silently lost', () => {
    expect(isDue({ due: 'not-a-date' } as any, new Date())).toBe(true);
    expect(isDue({ due: '' } as any, new Date())).toBe(true);
  });
});
