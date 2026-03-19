import React from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import SidebarTree from '../components/SidebarTree';
import i18n from '../app/i18n';

jest.mock('../stores/useStore', () => {
  return {
    useStore: () => ({
      notes: [
        { _id: 'p1', title: 'Projekt Alpha', content: '', type: '"project"', parentId: null, locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'p2', title: 'Projekt Beta', content: '', type: 'project-folder', parentId: null, locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n1', title: 'Vanlig anteckning', content: '', type: 'note', parentId: null, locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'p3', title: 'Projekt Gamma', content: '', type: 'Project Folder', parentId: 'n1', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'p4', title: 'Projekt Delta', content: '', type: '"`project`"', parentId: null, locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'p5', title: 'Projekt Låst', content: '', type: 'note', parentId: null, locked: true, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n4', title: 'Hemlig anteckning', content: '', type: 'note', parentId: 'p5', locked: true, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n2', title: 'Mötesanteckning', content: '', type: 'note', parentId: null, locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n3', title: 'Mötesanteckning barn', content: '', type: 'note', parentId: 'n2', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      tasks: [],
      selectedNoteId: null,
      selectedTaskListId: null,
      isLoading: false,
      error: null,
      searchQuery: '',
      sortOrder: 'date-desc',
      activeTab: 'notes',
      activeProjectId: null,
      unlockedProtectedNoteIds: [],
      setActiveProject: jest.fn(),
      setActiveTab: jest.fn(),
      setSortOrder: jest.fn(),
      setSearchQuery: jest.fn(),
      selectNote: jest.fn(),
      createNote: jest.fn(),
      deleteNote: jest.fn(),
      fetchNotes: jest.fn(),
      updateNote: jest.fn(),
      moveNote: jest.fn(),
      unlockNote: jest.fn(),
      language: 'sv',
      setLanguage: jest.fn(),
    }),
  };
});

describe('SidebarTree e2e project dropdown behavior', () => {
  it('visar projekt i projekt-dropdown och inte i anteckningslistan', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DndProvider backend={HTML5Backend}>
          <SidebarTree />
        </DndProvider>
      </I18nextProvider>
    );

    const projectSelect = screen.getByLabelText('Projektmapp') as HTMLSelectElement;
    expect(projectSelect).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Projekt Alpha' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Projekt Beta' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Projekt Gamma' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Projekt Delta' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Projekt Låst' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Mötesanteckning' })).toBeNull();

    const titleMatches = screen.getAllByText('Projekt Alpha');
    expect(titleMatches.length).toBe(1);
    const secondTitleMatches = screen.getAllByText('Projekt Beta');
    expect(secondTitleMatches.length).toBe(1);
    const thirdTitleMatches = screen.getAllByText('Projekt Gamma');
    expect(thirdTitleMatches.length).toBe(1);
    const fourthTitleMatches = screen.getAllByText('Projekt Delta');
    expect(fourthTitleMatches.length).toBe(1);
    const fifthTitleMatches = screen.getAllByText('Projekt Låst');
    expect(fifthTitleMatches.length).toBe(1);
    expect(screen.getByText('Vanlig anteckning')).toBeTruthy();
    expect(screen.getByText('Mötesanteckning')).toBeTruthy();
    expect(screen.getByText('Mötesanteckning barn')).toBeTruthy();
  });
});
