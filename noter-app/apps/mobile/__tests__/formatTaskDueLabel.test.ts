import { formatTaskDateLabel, formatTaskDueLabel } from '../utils/date';

describe('mobile formatTaskDueLabel', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('formats day before yesterday with time', () => {
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

  it('formats day before yesterday without time', () => {
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
