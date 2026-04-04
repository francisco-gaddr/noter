import { formatTaskDateLabel, formatTaskDueLabel } from '../lib/formatTaskDue';

describe('formatTaskDueLabel', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('formats today with time', () => {
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
    const due = new Date(2025, 2, 15, 13, 44, 0);
    const label = formatTaskDueLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
      timePrefix: 'kl',
    });
    expect(label).toBe('Idag kl 13:44');
  });

  it('formats tomorrow with time', () => {
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
    const due = new Date(2025, 2, 16, 15, 55, 0);
    const label = formatTaskDueLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
      timePrefix: 'kl',
    });
    expect(label).toBe('Imorgon kl 15:55');
  });

  it('formats same year with month name', () => {
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
    const due = new Date(2025, 2, 25, 17, 5, 0);
    const label = formatTaskDueLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
      timePrefix: 'kl',
    });
    expect(label).toBe('25 Mars kl 17:05');
  });

  it('formats different year with year', () => {
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
    const due = new Date(2028, 11, 25, 17, 5, 0);
    const label = formatTaskDueLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
      timePrefix: 'kl',
    });
    expect(label).toBe('25 December 2028 kl 17:05');
  });

  it('formats yesterday with time', () => {
    jest.setSystemTime(new Date(2025, 2, 15, 10, 0, 0));
    const due = new Date(2025, 2, 14, 0, 0, 0);
    const label = formatTaskDueLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
      timePrefix: 'kl',
    });
    expect(label).toBe('Igår kl 00:00');
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

  it('formats upcoming weekday within a week', () => {
    jest.setSystemTime(new Date(2025, 2, 13, 10, 0, 0));
    const due = new Date(2025, 2, 17, 16, 43, 0);
    const label = formatTaskDueLabel(due, {
      locale: 'sv',
      todayLabel: 'Idag',
      tomorrowLabel: 'Imorgon',
      yesterdayLabel: 'Igår',
      dayBeforeYesterdayLabel: 'I förrgår',
      timePrefix: 'kl',
    });
    expect(label).toBe('Måndag kl 16:43');
  });
});

describe('formatTaskDateLabel', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
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
