import React from 'react';
import { render, screen } from '@testing-library/react';
import SidebarTree from '../components/SidebarTree';
import { I18nextProvider } from 'react-i18next';
import i18n from '../app/i18n';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

jest.mock('../stores/useStore', () => {
  const state = {
    notes: [],
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
    setActiveProject: () => {},
    setActiveTab: () => {},
    selectNote: () => {},
    createNote: async () => {},
    deleteNote: async () => {},
    fetchNotes: async () => {},
    updateNote: async () => {},
    moveNote: async () => {},
    unlockNote: async () => {},
    setSortOrder: () => {},
    language: 'sv',
    setLanguage: () => {},
  };
  return {
    useStore: (selector?: any) => (selector ? selector(state) : state),
    __mockState: state,
  };
});

const { __mockState } = jest.requireMock('../stores/useStore') as { __mockState: any };

describe('SidebarTree', () => {
  beforeEach(() => {
    __mockState.notes = [];
    __mockState.tasks = [];
    __mockState.searchQuery = '';
    __mockState.activeTab = 'notes';
    __mockState.activeProjectId = null;
  });

  it('renderar flikar med översättningar (svenska)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DndProvider backend={HTML5Backend}>
          <SidebarTree />
        </DndProvider>
      </I18nextProvider>
    );
    const notesTab = screen.getByText('Anteckningar');
    const tasksTab = screen.getByText('Uppgifter');
    if (!notesTab) { throw new Error('Anteckningar saknas'); }
    if (!tasksTab) { throw new Error('Uppgifter saknas'); }
  });

  it('visar projektmappar i Alla anteckningar när inget projektfilter är valt', () => {
    __mockState.notes = [
      {
        _id: 'project-1',
        title: 'Projekt Alpha',
        content: '',
        type: 'project',
        parentId: null,
        locked: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        _id: 'note-1',
        title: 'Anteckning Alpha',
        content: '',
        type: 'note',
        parentId: 'project-1',
        locked: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    render(
      <I18nextProvider i18n={i18n}>
        <DndProvider backend={HTML5Backend}>
          <SidebarTree />
        </DndProvider>
      </I18nextProvider>
    );

    expect(screen.getByTestId('sidebar-note-project-1')).toBeTruthy();
  });
});
