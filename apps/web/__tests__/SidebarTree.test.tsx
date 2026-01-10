import React from 'react';
import { render, screen } from '@testing-library/react';
import SidebarTree from '../components/SidebarTree';
import { I18nextProvider } from 'react-i18next';
import i18n from '../app/i18n';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

jest.mock('../stores/useStore', () => {
  return {
    useStore: () => ({
      notes: [],
      tasks: [],
      selectedNoteId: null,
      selectedTaskListId: null,
      isLoading: false,
      error: null,
      searchQuery: '',
      sortOrder: 'date-desc',
      activeTab: 'notes',
      setActiveTab: () => {},
      selectNote: () => {},
      createNote: async () => {},
      deleteNote: async () => {},
      fetchNotes: async () => {},
      updateNote: async () => {},
      moveNote: async () => {},
      setSortOrder: () => {},
      language: 'sv',
      setLanguage: () => {},
    }),
  };
});

describe('SidebarTree', () => {
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
});
