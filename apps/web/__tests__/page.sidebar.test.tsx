/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Home from '../app/page';

jest.mock('../components/Navbar', () => {
  return function Navbar() {
    return <div data-testid="navbar" />;
  };
});

jest.mock('../components/SidebarTree', () => {
  return function SidebarTree() {
    return <div data-testid="sidebar-tree" />;
  };
});

jest.mock('../components/NoteEditor', () => {
  return function NoteEditor() {
    return <div data-testid="note-editor" />;
  };
});

jest.mock('../components/TaskList', () => {
  return function TaskList() {
    return <div data-testid="task-list" />;
  };
});

jest.mock('../components/Auth', () => {
  return function Auth() {
    return <div data-testid="auth" />;
  };
});

jest.mock('react-dnd', () => {
  return {
    DndProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

jest.mock('react-dnd-html5-backend', () => {
  return {
    HTML5Backend: {},
  };
});

jest.mock('../stores/useStore', () => {
  return {
    useStore: () => ({
      initSocket: () => {},
      user: { username: 'test' },
      activeTab: 'notes',
      isHydrated: true,
    }),
  };
});

describe('Sidebar collapse', () => {
  it('kan fälla in och ut sidopanelen', async () => {
    render(<Home />);

    const aside = await screen.findByLabelText('Sidopanel');
    expect(aside).toHaveStyle({ width: '256px' });

    fireEvent.click(await screen.findByLabelText('Fäll in sidopanel'));
    expect(aside).toHaveStyle({ width: '0px' });

    fireEvent.click(await screen.findByLabelText('Fäll ut sidopanel'));
    expect(aside).toHaveStyle({ width: '256px' });
  });
});
