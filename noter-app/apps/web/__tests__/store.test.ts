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
    decryptTasks: jest.fn((tasks: any[]) => Promise.resolve(tasks)),
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
    getNoteSyncIndex: jest.fn().mockResolvedValue(new Map()),
    getPendingSyncNotes: jest.fn().mockResolvedValue([]),
    saveTask: jest.fn(),
    getAllTasks: jest.fn().mockResolvedValue([]),
    getTaskSyncIndex: jest.fn().mockResolvedValue(new Map()),
    getPendingSyncTasks: jest.fn().mockResolvedValue([]),
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
    sessionStorage.setItem('token', 'abc');

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

  it('should restore active project selection from localStorage on hydrate', () => {
    localStorage.setItem('activeProjectId', 'project-abc');
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    sessionStorage.setItem('token', 'abc');

    act(() => {
      useStore.getState().hydrate();
    });

    expect(useStore.getState().activeProjectId).toBe('project-abc');
  });

  it('should restore sort order from localStorage on hydrate', () => {
    localStorage.setItem('sortOrder', 'title-desc');
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    sessionStorage.setItem('token', 'abc');

    act(() => {
      useStore.getState().hydrate();
    });

    expect(useStore.getState().sortOrder).toBe('title-desc');
  });

  it('should ignore stale isAppLocked flag on hydrate when no app lock password is configured', () => {
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    sessionStorage.setItem('token', 'abc');
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

  it('should keep plain project type when decryption returns empty', async () => {
    const { api } = require('../services/api');
    api.fetchNotes.mockResolvedValueOnce([
      {
        _id: 'p1',
        title: 'Projekt',
        content: '',
        type: 'project-folder',
        parentId: null,
        locked: 'false',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await act(async () => {
      await useStore.getState().fetchNotes();
    });

    const state = useStore.getState();
    expect(state.notes[0]?.type).toBe('project');
  });

  it('should dedupe concurrent fetchNotes calls', async () => {
    const { api } = require('../services/api');
    let resolveFetch: ((value: any[]) => void) | null = null;
    api.fetchNotes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const first = useStore.getState().fetchNotes();
    const second = useStore.getState().fetchNotes();

    await Promise.resolve();
    expect(api.fetchNotes).toHaveBeenCalledTimes(1);

    resolveFetch?.([]);
    await act(async () => {
      await Promise.all([first, second]);
    });
  });

  it('should skip unchanged note writes during fetchNotes', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    api.fetchNotes.mockResolvedValueOnce([
      { _id: 'note-unchanged', title: 'A', content: '', type: 'note', locked: false, createdAt: now, updatedAt: now },
      { _id: 'note-changed', title: 'B', content: '', type: 'note', locked: false, createdAt: now, updatedAt: new Date(Date.now() + 1000).toISOString() },
    ]);
    db.getNoteSyncIndex.mockResolvedValueOnce(new Map([['note-unchanged', now]]));

    await act(async () => {
      await useStore.getState().fetchNotes();
    });

    expect(db.saveNote).toHaveBeenCalledTimes(1);
    expect(db.saveNote).toHaveBeenCalledWith(expect.objectContaining({ _id: 'note-changed' }));
  });

  it('should skip unchanged task writes during fetchTasks', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    api.fetchTasks.mockResolvedValueOnce([
      { _id: 'task-unchanged', title: 'A', description: '', completed: false, priority: 'medium', createdAt: now, updatedAt: now, parentNoteId: null },
      { _id: 'task-changed', title: 'B', description: '', completed: false, priority: 'medium', createdAt: now, updatedAt: new Date(Date.now() + 1000).toISOString(), parentNoteId: null },
    ]);
    db.getTaskSyncIndex.mockResolvedValueOnce(new Map([['task-unchanged', now]]));

    await act(async () => {
      await useStore.getState().fetchTasks();
    });

    expect(db.saveTask).toHaveBeenCalledTimes(1);
    expect(db.saveTask).toHaveBeenCalledWith(expect.objectContaining({ _id: 'task-changed' }));
  });

  it('should relock project session when leaving active project', async () => {
    useStore.setState({
      activeProjectId: 'p1',
      unlockedProtectedNoteIds: ['p1'],
      notes: [
        { _id: 'p1', title: 'Projekt', content: '', type: 'project', parentId: null, locked: true, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any,
        { _id: 'n1', title: 'Synlig', content: 'Hej', type: 'note', parentId: 'p1', locked: false, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any,
      ],
    } as any);

    useStore.getState().setActiveProject(null);
    const state = useStore.getState();
    expect(state.unlockedProtectedNoteIds).not.toContain('p1');
    expect((state.notes.find((n: any) => n._id === 'n1') as any)?.locked).toBe(true);
  });

});
