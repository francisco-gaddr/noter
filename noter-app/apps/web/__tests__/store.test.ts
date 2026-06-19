import { act } from '@testing-library/react';
import { expect } from '@jest/globals';
import { useStore } from '../stores/useStore';

// Mocks
jest.mock('../services/api', () => ({
  getUUID: jest.fn(() => 'mock-uuid'),
  setApiToken: jest.fn(),
  api: {
    login: jest.fn(),
    register: jest.fn(),
    fetchNotes: jest.fn(),
    getNote: jest.fn(),
    createNote: jest.fn(),
    updateNote: jest.fn(),
    deleteNote: jest.fn(),
    fetchTasks: jest.fn(),
    createTask: jest.fn(),
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
  },
}));

jest.mock('../services/socket', () => ({
  socket: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    connect: jest.fn(),
    connected: true,
  },
  connectSocket: jest.fn(),
  disconnectSocket: jest.fn(),
  setSocketToken: jest.fn(),
}));

jest.mock('../services/db', () => ({
  db: {
    saveNote: jest.fn(),
    getAllNotes: jest.fn().mockResolvedValue([]),
    getPendingSyncNotes: jest.fn().mockResolvedValue([]),
    saveTask: jest.fn(),
    getAllTasks: jest.fn().mockResolvedValue([]),
  },
}));

describe('Web Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStore.setState({
      notes: [],
      tasks: [],
      user: null,
      token: null,
    });
  });

  it('should have initial state', () => {
    const state = useStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it('should set user and token on login', async () => {
    const { api } = require('../services/api');
    api.login.mockResolvedValueOnce({ user: { _id: '1', username: 'test' }, token: 'abc' });

    await act(async () => {
        await useStore.getState().login('test', 'password');
    });

    const state = useStore.getState();
    expect(state.user).toEqual({ _id: '1', username: 'test' });
    expect(state.token).toBe('abc');
  });

  it('should init socket on hydrate when token exists', () => {
    const { connectSocket } = require('../services/socket');
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    localStorage.setItem('token', 'abc');

    act(() => {
      useStore.getState().hydrate();
    });

    expect(useStore.getState().token).toBe('abc');
    expect(connectSocket).toHaveBeenCalled();
  });

  it('should persist sort order in localStorage', () => {
    act(() => {
      useStore.getState().setSortOrder('title-asc');
    });

    expect(localStorage.getItem('sortOrder')).toBe('title-asc');
    expect(useStore.getState().sortOrder).toBe('title-asc');
  });

  it('should persist active project selection in localStorage', () => {
    act(() => {
      useStore.getState().setActiveProject('project-123');
    });

    expect(localStorage.getItem('activeProjectId')).toBe('project-123');
    expect(useStore.getState().activeProjectId).toBe('project-123');
  });

  // SECURITY: leaving the app (tab hidden) must re-lock every unlocked protected folder, so a
  // note inside a locked folder re-masks and cannot be read without re-entering the password.
  it('relockProtectedFolders re-locks unlocked folders and re-masks their notes (idempotent)', () => {
    const lockedFolder = { _id: 'lf', type: 'project', locked: true, title: 'Hemlig mapp', parentId: null };
    const child = { _id: 'c1', type: 'note', parentId: 'lf', title: 'Hemlig text', content: 'topphemligt' };
    act(() => {
      useStore.setState({ notes: [lockedFolder, child] as any, unlockedProtectedNoteIds: ['lf'] });
    });

    act(() => {
      useStore.getState().relockProtectedFolders();
    });

    const state = useStore.getState();
    expect(state.unlockedProtectedNoteIds).toEqual([]);
    const masked = state.notes.find((n) => n._id === 'c1') as any;
    expect(masked.title).toBe('Låst anteckning');
    expect(masked.content).toBe('');

    // Idempotent + free: a second call when nothing is unlocked is a no-op (no new array).
    const before = useStore.getState().notes;
    act(() => {
      useStore.getState().relockProtectedFolders();
    });
    expect(useStore.getState().notes).toBe(before);
    expect(useStore.getState().unlockedProtectedNoteIds).toEqual([]);
  });

  // SECURITY (ADR-0012): app-lock must wipe the in-memory folder-key session, so a locked
  // folder is cryptographically re-locked (not just masked) when the app locks.
  it('clears the folder-key session on app-lock', () => {
    const { setFolderKey, folderKeySessionSize } = require('@repo/shared');
    setFolderKey('proj-1', new Uint8Array(32).fill(9));
    expect(folderKeySessionSize()).toBe(1);
    act(() => {
      useStore.getState().setAppLocked(true);
    });
    expect(folderKeySessionSize()).toBe(0);
  });

  // ADR-0012 read path: a v3f-sealed note inside an unlocked folder materialises decrypted when
  // the folder key is in the session, and stays masked (never shows ciphertext) without it.
  it('materializes a v3f note decrypted with the session folder key, masked without it', () => {
    const { clearAllFolderKeys, setFolderKey, wrapNoteForFolder, generateDataKey } = require('@repo/shared');
    clearAllFolderKeys();
    const key = generateDataKey();
    const folder = { _id: 'lf', type: 'project', locked: true, title: 'Mapp', parentId: null };
    const other = { _id: 'lf2', type: 'project', locked: true, title: 'Mapp2', parentId: null };
    const note = {
      _id: 'n1', type: 'note', parentId: 'lf',
      title: wrapNoteForFolder('Hemlig titel', key),
      content: wrapNoteForFolder('Hemligt innehåll', key),
    };
    // With the key in the session → decrypts. setActiveProject('lf') drops lf2 from the unlock set,
    // forcing a re-materialize with unlock = {lf} (so the note is readable, not masked).
    setFolderKey('lf', key);
    act(() => {
      useStore.setState({ notes: [folder, other, note] as any, unlockedProtectedNoteIds: ['lf', 'lf2'] });
      useStore.getState().setActiveProject('lf');
    });
    let got = useStore.getState().notes.find((n) => n._id === 'n1') as any;
    expect(got.title).toBe('Hemlig titel');
    expect(got.content).toBe('Hemligt innehåll');

    // Without the key → masked, and never the raw v3f envelope.
    clearAllFolderKeys();
    act(() => {
      useStore.setState({ notes: [folder, other, note] as any, unlockedProtectedNoteIds: ['lf', 'lf2'] });
      useStore.getState().setActiveProject('lf');
    });
    got = useStore.getState().notes.find((n) => n._id === 'n1') as any;
    expect(got.title).toBe('Låst anteckning');
    expect(got.content).toBe('');
    expect(got.title).not.toContain('v3f:');
  });

  it('should restore active project selection from localStorage on hydrate', () => {
    localStorage.setItem('activeProjectId', 'project-abc');
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    localStorage.setItem('token', 'abc');

    act(() => {
      useStore.getState().hydrate();
    });

    expect(useStore.getState().activeProjectId).toBe('project-abc');
  });

  it('should restore sort order from localStorage on hydrate', () => {
    localStorage.setItem('sortOrder', 'title-desc');
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    localStorage.setItem('token', 'abc');

    act(() => {
      useStore.getState().hydrate();
    });

    expect(useStore.getState().sortOrder).toBe('title-desc');
  });

  it('should ignore stale isAppLocked flag on hydrate when no app lock password is configured', () => {
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    localStorage.setItem('token', 'abc');
    localStorage.setItem('isAppLocked', 'true');
    localStorage.removeItem('appLockPasswordHash');

    act(() => {
      useStore.getState().hydrate();
    });

    expect(useStore.getState().isAppLocked).toBe(false);
  });

  it('should mask content when locking and send password', async () => {
    const { api } = require('../services/api');
    useStore.setState({
      notes: [{ _id: 'note-1', title: 'Titel', content: 'Innehåll', locked: false } as any],
    });

    api.updateNote.mockResolvedValueOnce({
      _id: 'note-1',
      title: 'Låst anteckning',
      content: '',
      locked: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await act(async () => {
      await useStore.getState().updateNote('note-1', 'Titel', 'Innehåll', true, 'secret');
    });

    const state = useStore.getState();
    expect(state.notes[0].title).toBe('Låst anteckning');
    expect(state.notes[0].content).toBe('');
    expect(api.updateNote).toHaveBeenCalledWith('note-1', expect.objectContaining({ locked: true, password: 'secret' }));
  });

  it('should create a note', async () => {
      const { api } = require('../services/api');
      const newNote = { _id: '123', title: 'New Note', content: '', type: 'note' };
      api.createNote.mockResolvedValueOnce(newNote);

      await act(async () => {
          await useStore.getState().createNote('New Note');
      });
      
      expect(api.createNote).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Note' }));
  });

  // Regression: the create-response can OMIT or return `type` still-encrypted. The store must
  // trust the type WE requested, else a new task_list/project classifies as a plain 'note' and
  // vanishes from the Tasks view + the project-folder dropdown (the recurring Electron bug).
  it('keeps the requested type for a new task list even when the API omits it', async () => {
      const { api } = require('../services/api');
      api.createNote.mockResolvedValueOnce({ _id: 'tl-1', title: 'Inköp', content: '' }); // no `type`
      await act(async () => {
          await useStore.getState().createNote('Inköp', null, 'task_list');
      });
      const created = useStore.getState().notes.find((n) => n._id === 'tl-1');
      expect(created?.type).toBe('task_list');
      expect(useStore.getState().selectedTaskListId).toBe('tl-1');
  });

  it('keeps the requested type for a new project folder even when the API returns a wrong/encrypted type', async () => {
      const { api } = require('../services/api');
      api.createNote.mockResolvedValueOnce({ _id: 'pf-1', title: 'Hem', content: '', type: 'U2FsdGVkX1junk' });
      await act(async () => {
          await useStore.getState().createNote('Hem', null, 'project');
      });
      const created = useStore.getState().notes.find((n) => n._id === 'pf-1');
      expect(created?.type).toBe('project');
  });

});
