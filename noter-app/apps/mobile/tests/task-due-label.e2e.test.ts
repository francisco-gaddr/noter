import { formatTaskDateLabel, formatTaskDueLabel } from '../utils/date';

describe('task due label e2e', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows day before yesterday with time', () => {
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

  it('shows day before yesterday without time', () => {
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
