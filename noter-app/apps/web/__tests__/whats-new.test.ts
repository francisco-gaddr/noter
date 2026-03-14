import { WHATS_NEW_ENTRIES } from '@repo/shared';

describe('whats new entries', () => {
  it('contains at least one release entry', () => {
    expect(Array.isArray(WHATS_NEW_ENTRIES)).toBe(true);
    expect(WHATS_NEW_ENTRIES.length).toBeGreaterThan(0);
  });

  it('has required fields for each entry', () => {
    for (const entry of WHATS_NEW_ENTRIES) {
      expect(entry.version).toBeTruthy();
      expect(entry.build).toBeTruthy();
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(entry.highlights)).toBe(true);
      expect(entry.highlights.length).toBeGreaterThan(0);
    }
  });
});
