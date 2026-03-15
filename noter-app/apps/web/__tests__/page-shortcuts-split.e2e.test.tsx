import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Home from '../app/page';

jest.mock('react-dnd', () => ({
  DndProvider: ({ children }: any) => <>{children}</>,
}));

jest.mock('react-dnd-html5-backend', () => ({
  HTML5Backend: {},
}));

jest.mock('../components/Navbar', () => (props: any) => (
  <button onClick={props.onToggleSidebar} data-testid="navbar-toggle">
    Navbar
  </button>
));
jest.mock('../components/SidebarTree', () => () => <div data-testid="sidebar-tree">Sidebar</div>);
jest.mock('../components/NoteEditor', () => () => <div data-testid="note-editor">NoteEditor</div>);
jest.mock('../components/TaskList', () => () => <div data-testid="task-list">TaskList</div>);
jest.mock('../components/Auth', () => () => <div data-testid="auth-view">Auth</div>);

jest.mock('../stores/useStore', () => ({
  useStore: () => ({
    initSocket: jest.fn(),
    user: { _id: 'u1', username: 'user' },
    activeTab: 'notes',
    isHydrated: true,
  }),
}));

describe('Home shortcuts and split view', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('toggles AI sidebar with Ctrl+Alt+X', () => {
    const listener = jest.fn();
    window.addEventListener('ai-sidebar-toggle', listener);
    render(<Home />);

    fireEvent.keyDown(window, { key: 'x', ctrlKey: true, altKey: true });
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener('ai-sidebar-toggle', listener);
  });

  it('toggles split view with Ctrl+Alt+V', () => {
    render(<Home />);

    expect(screen.getByTestId('note-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('split-main-content')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true, altKey: true });
    expect(screen.getByTestId('split-main-content')).toBeInTheDocument();
    expect(screen.getByTestId('split-notes-pane')).toBeInTheDocument();
    expect(screen.getByTestId('split-tasks-pane')).toBeInTheDocument();
    expect(screen.getByTestId('split-divider')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true, altKey: true });
    expect(screen.queryByTestId('split-main-content')).not.toBeInTheDocument();
  });
});
