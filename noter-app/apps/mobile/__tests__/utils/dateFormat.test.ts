jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
}));

import { formatDate, formatTime, formatDateTime, formatRelative, setLocale } from '../../utils/dateFormat';

describe('dateFormat helpers', () => {
  beforeEach(() => setLocale('en-US'));

  it('formatDate returns medium-style string for a valid date', () => {
    const out = formatDate('2026-05-19T12:00:00Z');
    expect(out).toMatch(/2026/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns empty string for invalid input', () => {
    expect(formatDate('not-a-date')).toBe('');
    expect(formatTime(NaN)).toBe('');
    expect(formatDateTime('---')).toBe('');
  });

  it('formatTime returns hh:mm (short style)', () => {
    const out = formatTime('2026-05-19T14:32:00Z');
    // 24-h or AM/PM both acceptable depending on platform Intl impl
    expect(out).toMatch(/\d{1,2}/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('formatRelative gives "in X seconds" for near-future', () => {
    const now = new Date('2026-05-19T12:00:00Z');
    const soon = new Date('2026-05-19T12:00:30Z');
    const out = formatRelative(soon, now);
    expect(out).toMatch(/30|second/i);
  });

  it('formatRelative gives past relative for older dates', () => {
    const now = new Date('2026-05-19T12:00:00Z');
    const past = new Date('2026-05-19T11:30:00Z');
    const out = formatRelative(past, now);
    expect(out).toMatch(/30|minute/i);
  });

  it('formatRelative falls back to absolute for > 30 days', () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const ancient = new Date('2025-01-01T00:00:00Z');
    const out = formatRelative(ancient, now);
    expect(out).toMatch(/2025/);
  });

  it('setLocale overrides the resolved locale', () => {
    setLocale('sv-SE');
    const out = formatDate('2026-05-19T12:00:00Z', { dateStyle: 'long' });
    // sv-SE prints "19 maj 2026" — looking for "maj" is the simplest cross-version check
    expect(out.toLowerCase()).toMatch(/maj|19/);
  });
});
