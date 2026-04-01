import React from 'react';
import { render, waitFor } from '@testing-library/react';
import TaskList from '../components/TaskList';

const storeMock = {
  notes: [],
  tasks: [],
  fetchTasks: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  deleteTask: jest.fn(),
  reorderTasks: jest.fn(),
  selectedTaskListId: null,
  updateNote: jest.fn(),
  isLoading: false,
  searchQuery: '',
};

jest.mock('../stores/useStore', () => ({
  useStore: (selector: any) => (selector ? selector(storeMock) : storeMock),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../components/TaskDetailModal', () => ({ TaskDetailModal: () => null }));
jest.mock('../components/TaskBoard', () => () => null);
jest.mock('../components/TaskCalendar', () => () => null);
jest.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, jest.fn()],
  useDrop: () => [{ handlerId: null }, jest.fn()],
}));

describe('Task filter persistence e2e', () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).mlc = {
      isElectron: true,
      getManySettings: jest.fn(async () => ({
        taskSortBy: 'dueDate',
        taskViewMode: 'list',
        taskQuickFilter: null,
        taskStatusFilter: 'active',
        taskFilterDateRange: JSON.stringify({ start: null, end: null }),
      })),
      getSetting: jest.fn(async (key: string) => {
        if (key === 'taskSortBy') return 'dueDate';
        if (key === 'taskViewMode') return 'list';
        if (key === 'taskQuickFilter') return null;
        if (key === 'taskStatusFilter') return 'active';
        if (key === 'taskFilterDateRange') return JSON.stringify({ start: null, end: null });
        return null;
      }),
      setManySettings: jest.fn(async () => true),
      setSetting: jest.fn(async () => true),
    };
  });

  it('återläser statusfilter active från electron settings efter reload', async () => {
    render(<TaskList />);

    await waitFor(() => {
      expect((window as any).mlc.getManySettings).toHaveBeenCalledWith([
        'taskSortBy',
        'taskViewMode',
        'taskFilterDateRange',
        'taskQuickFilter',
        'taskStatusFilter',
      ]);
    });

    await waitFor(() => {
      expect((window as any).mlc.setManySettings).toHaveBeenCalledWith(expect.objectContaining({
        taskStatusFilter: 'active',
      }));
    });
  });
});
