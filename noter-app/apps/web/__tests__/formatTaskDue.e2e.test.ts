import { formatTaskDateLabel, formatTaskDueLabel } from '../lib/formatTaskDue';

describe('formatTaskDueLabel e2e', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('formats day before yesterday in Swedish', () => {
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
    const due = new Date(2025, 2, 13, 16, 0, 0);
    const label = formatTaskDueLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
      timePrefix: 'kl',
    });
    expect(label).toBe('I förrgår kl 16:00');
  });

  it('formats day before yesterday date without time', () => {
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
    const due = new Date(2025, 2, 13, 16, 0, 0);
    const label = formatTaskDateLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
    });
    expect(label).toBe('I förrgår');
  });
});
