import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import SidebarTree from '../components/SidebarTree';
import i18n from '../app/i18n';

const mockSelectNote = jest.fn();
const mockSetActiveProject = jest.fn();
const mockUnlockNote = jest.fn();

let mockState: any;

jest.mock('../stores/useStore', () => ({
  useStore: (selector?: any) => {
    const state = mockState;
    return selector ? selector(state) : state;
  },
}));

const renderSidebar = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <DndProvider backend={HTML5Backend}>
        <SidebarTree />
      </DndProvider>
    </I18nextProvider>,
  );

describe('SidebarTree lock flow e2e', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockState = {
      notes: [
        { _id: 'p1', title: 'Projekt Låst', content: '', type: 'project', parentId: null, locked: true, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'sp1', title: 'Underprojekt', content: '', type: 'project', parentId: 'p1', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n1', title: 'Anteckning i projekt', content: '', type: 'note', parentId: 'p1', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n4', title: 'Djup anteckning', content: '', type: 'note', parentId: 'sp1', locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n2', title: 'Öppen anteckning', content: '', type: 'note', parentId: null, locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { _id: 'n3', title: 'Låst anteckning', content: '', type: 'note', parentId: null, locked: true, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
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
      setActiveProject: mockSetActiveProject,
      setActiveTab: jest.fn(),
      setSortOrder: jest.fn(),
      setSearchQuery: jest.fn(),
      selectNote: mockSelectNote,
      createNote: jest.fn(),
      deleteNote: jest.fn(),
      fetchNotes: jest.fn(),
      updateNote: jest.fn(),
      moveNote: jest.fn(),
      unlockNote: mockUnlockNote,
      language: 'sv',
      setLanguage: jest.fn(),
    };
  });

  it('döljer projektanteckningar från Alla anteckningar', () => {
    renderSidebar();

    expect(screen.getByText('Öppen anteckning')).toBeTruthy();
    expect(screen.queryByText('Anteckning i projekt')).toBeNull();
    expect(screen.queryByText('Djup anteckning')).toBeNull();
  });

  it('visar direkt underprojekt när ett projekt är valt så att nested innehåll inte försvinner i Electron-trädet', () => {
    mockState.activeProjectId = 'p1';
    mockState.unlockedProtectedNoteIds = ['p1'];
    renderSidebar();

    expect(screen.getByTestId('sidebar-note-sp1')).toBeTruthy();
    expect(screen.getByText('Anteckning i projekt')).toBeTruthy();
  });

  it('öppnar lösenordsmodal direkt och fokuserar fältet när man klickar på låst anteckning', async () => {
    const user = userEvent.setup();
    mockUnlockNote.mockResolvedValue(true);
    renderSidebar();

    await user.click(screen.getByTestId('sidebar-note-n3'));

    const passwordInput = await screen.findByTestId('password-input');
    expect(passwordInput).toHaveFocus();

    await user.type(passwordInput, 'secret');
    await user.click(screen.getByTestId('password-submit'));

    await waitFor(() => {
      expect(mockUnlockNote).toHaveBeenCalledWith('n3', 'secret');
      expect(mockSelectNote).toHaveBeenCalledWith('n3');
    });
  });

  it('öppnar lösenordsmodal direkt för låst projektval i projektfältet', async () => {
    renderSidebar();

    fireEvent.change(screen.getByLabelText('Projektmapp'), { target: { value: 'p1' } });

    const passwordInput = await screen.findByTestId('password-input');
    expect(passwordInput).toHaveFocus();
  });
});
