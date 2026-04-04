export const formatTaskDueLabel = (
  dueDate: Date,
  options: {
    locale: string;
    todayLabel: string;
    tomorrowLabel: string;
    yesterdayLabel: string;
    dayBeforeYesterdayLabel: string;
    timePrefix: string;
  }
) => {
  if (!dueDate || Number.isNaN(dueDate.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfToday.getDate() + 1);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);
  const startOfDayBeforeYesterday = new Date(startOfToday);
  startOfDayBeforeYesterday.setDate(startOfToday.getDate() - 2);
  const startOfDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  const time = `${String(dueDate.getHours()).padStart(2, '0')}:${String(dueDate.getMinutes()).padStart(2, '0')}`;

  if (startOfDate.getTime() === startOfToday.getTime()) {
    return `${options.todayLabel} ${options.timePrefix} ${time}`;
  }
  if (startOfDate.getTime() === startOfTomorrow.getTime()) {
    return `${options.tomorrowLabel} ${options.timePrefix} ${time}`;
  }
  if (startOfDate.getTime() === startOfYesterday.getTime()) {
    return `${options.yesterdayLabel} ${options.timePrefix} ${time}`;
  }
  if (startOfDate.getTime() === startOfDayBeforeYesterday.getTime()) {
    return `${options.dayBeforeYesterdayLabel} ${options.timePrefix} ${time}`;
  }

  const dayDiff = Math.round((startOfDate.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDiff > 1 && dayDiff < 7) {
    const weekdayRaw = new Intl.DateTimeFormat(options.locale, { weekday: 'long' }).format(dueDate);
    const weekday = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);
    return `${weekday} ${options.timePrefix} ${time}`;
  }

  const monthRaw = new Intl.DateTimeFormat(options.locale, { month: 'long' }).format(dueDate);
  const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
  const day = dueDate.getDate();
  const year = dueDate.getFullYear() !== now.getFullYear() ? ` ${dueDate.getFullYear()}` : '';
  return `${day} ${month}${year} ${options.timePrefix} ${time}`;
};

export const formatTaskDateLabel = (
  date: Date,
  options: {
    locale: string;
    todayLabel: string;
    tomorrowLabel: string;
    yesterdayLabel: string;
    dayBeforeYesterdayLabel: string;
  }
) => {
  if (!date || Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfToday.getDate() + 1);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);
  const startOfDayBeforeYesterday = new Date(startOfToday);
  startOfDayBeforeYesterday.setDate(startOfToday.getDate() - 2);
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (startOfDate.getTime() === startOfToday.getTime()) return options.todayLabel;
  if (startOfDate.getTime() === startOfTomorrow.getTime()) return options.tomorrowLabel;
  if (startOfDate.getTime() === startOfYesterday.getTime()) return options.yesterdayLabel;
  if (startOfDate.getTime() === startOfDayBeforeYesterday.getTime()) return options.dayBeforeYesterdayLabel;

  const dayDiff = Math.round((startOfDate.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDiff > 1 && dayDiff < 7) {
    const weekdayRaw = new Intl.DateTimeFormat(options.locale, { weekday: 'long' }).format(date);
    const weekday = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);
    return weekday;
  }

  const monthRaw = new Intl.DateTimeFormat(options.locale, { month: 'long' }).format(date);
  const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
  const day = date.getDate();
  const year = date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : '';
  return `${day} ${month}${year}`;
};
