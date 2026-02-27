import { ICON_LIST } from '@repo/shared';

describe('Shared Constants', () => {
  it('should have a valid ICON_LIST', () => {
    expect(Array.isArray(ICON_LIST)).toBe(true);
    expect(ICON_LIST.length).toBeGreaterThan(0);
    expect(ICON_LIST).toContain('FaBriefcase');
    expect(ICON_LIST).toContain('FaPizzaSlice');
  });
});
