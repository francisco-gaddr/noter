import { buildTimeContextLines } from './timeContext';

describe('buildTimeContextLines', () => {
  const now = new Date('2026-06-14T10:00:00.000Z');

  it('states the current time and defines Swedish relative vocabulary', () => {
    const text = buildTimeContextLines(now).join('\n');
    expect(text).toContain('NUVARANDE TID');
    expect(text).toContain('2026-06-14T10:00:00.000Z'); // ISO now
    expect(text).toContain('"en kvart" = 15 minuter');
    expect(text).toContain('"om en timme" = 60 minuter');
  });

  it('includes worked ISO examples computed from now (the +15min fix)', () => {
    const text = buildTimeContextLines(now).join('\n');
    expect(text).toContain('2026-06-14T10:15:00.000Z'); // +15 min ("om en kvart")
    expect(text).toContain('2026-06-14T10:30:00.000Z'); // +30 min
    expect(text).toContain('2026-06-14T11:00:00.000Z'); // +60 min
    expect(text).toContain('2026-06-15T10:00:00.000Z'); // +1 day
  });
});
