import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import TaskCalendar from '../components/TaskCalendar';

const renderedCalendarProps: any[] = [];
const dndMock = jest.fn((Component: any) => Component);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'sv' } }),
}));

jest.mock('../stores/useStore', () => ({
  useStore: (selector?: any) => {
    const state = { updateTask: jest.fn() };
    return selector ? selector(state) : state;
  },
}));

jest.mock('react-big-calendar', () => ({
  Calendar: (props: any) => {
    renderedCalendarProps.push(props);
    return null;
  },
  dateFnsLocalizer: jest.fn(() => ({})),
}));

jest.mock('react-big-calendar/lib/addons/dragAndDrop', () => ({
  __esModule: true,
  default: (component: any) => dndMock(component),
}));

describe('TaskCalendar', () => {
  beforeEach(() => {
    renderedCalendarProps.length = 0;
    dndMock.mockClear();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-12T13:45:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets scrollToTime to current time for day/week timeline usability', () => {
    render(
      <TaskCalendar
        tasks={[]}
        onTaskClick={jest.fn()}
        view="week"
      />
    );
    const props = renderedCalendarProps[0];
    expect(props.scrollToTime).toBeInstanceOf(Date);
    expect(props.scrollToTime.getUTCHours()).toBe(13);
    expect(props.scrollToTime.getUTCMinutes()).toBe(45);
    expect(props.views).toEqual(['month', 'week', 'day', 'agenda']);
  });
});
