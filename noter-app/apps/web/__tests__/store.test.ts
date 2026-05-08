import { act } from '@testing-library/react';
import { expect } from '@jest/globals';
import { clearEncryptionKey, setEncryptionKey } from '@repo/shared';
import { useStore } from '../stores/useStore';

// Mocks
jest.mock('../services/api', () => ({
  getUUID: jest.fn(() => 'mock-uuid'),
  probeBackendReachability: jest.fn().mockResolvedValue(true),
  setApiToken: jest.fn(),
  setApiRefreshToken: jest.fn(),
  setApiAuthTokenListener: jest.fn(),
  api: {
    login: jest.fn(),
    register: jest.fn(),
    restoreSession: jest.fn().mockResolvedValue(null),
    fetchNotes: jest.fn(),
    fetchNoteChanges: jest.fn().mockResolvedValue({ items: [], serverTime: new Date('2026-01-01T00:00:00.000Z').toISOString() }),
    decryptTasks: jest.fn((tasks: any[]) => Promise.resolve(tasks)),
    getNote: jest.fn(),
    verifyLock: jest.fn(),
    createNote: jest.fn(),
    updateNote: jest.fn(),
    deleteNote: jest.fn(),
    syncNotes: jest.fn().mockResolvedValue({ results: [], serverTime: new Date('2026-01-01T00:00:00.000Z').toISOString() }),
    fetchTasks: jest.fn(),
    fetchTaskChanges: jest.fn().mockResolvedValue({ items: [], serverTime: new Date('2026-01-01T00:00:00.000Z').toISOString() }),
    createTask: jest.fn(),
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
    syncTasks: jest.fn().mockResolvedValue({ results: [], serverTime: new Date('2026-01-01T00:00:00.000Z').toISOString() }),
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
    deleteNote: jest.fn(),
    markAsDeleted: jest.fn(),
    saveTask: jest.fn(),
    getAllTasks: jest.fn().mockResolvedValue([]),
    getTaskSyncIndex: jest.fn().mockResolvedValue(new Map()),
    getPendingSyncTasks: jest.fn().mockResolvedValue([]),
    deleteTask: jest.fn(),
    markTaskAsDeleted: jest.fn(),
  },
}));

describe('Web Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).mlc;
    setEncryptionKey('a'.repeat(64));
    useStore.setState({
      notes: [],
      tasks: [],
      user: null,
      token: null,
      activeProjectId: null,
      selectedNoteId: null,
      selectedTaskListId: null,
      unlockedProtectedNoteIds: [],
      activeTab: 'notes',
    });
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  it('should have initial state', () => {
    const state = useStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it('should set user and token on login', async () => {
    const { api } = require('../services/api');
    api.login.mockResolvedValueOnce({ user: { _id: '1', username: 'test' }, token: 'abc', refreshToken: 'refresh-1' });

    await act(async () => {
        await useStore.getState().login('test', 'password');
    });

    const state = useStore.getState();
    expect(state.user).toEqual({ _id: '1', username: 'test' });
    expect(state.token).toBe('abc');
  });

  it('should init socket on hydrate when token exists', async () => {
    const { connectSocket } = require('../services/socket');
    (window as any).mlc = { isElectron: true };
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    sessionStorage.setItem('token', 'abc');

    await act(async () => {
      useStore.getState().hydrate();
      await Promise.resolve();
      await Promise.resolve();
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

  it('should bootstrap electron settings before first sync when electron bridge exists', async () => {
    (window as any).mlc = {
      isElectron: true,
      getManySettings: jest.fn().mockResolvedValue({
        apiBaseUrl: 'http://127.0.0.1:3001/api',
      }),
      getSession: jest.fn().mockResolvedValue({
        token: 'abc',
        user: { _id: '1', username: 'test' },
      }),
      getSetting: jest.fn(),
      setManySettings: jest.fn(),
      setSetting: jest.fn(),
    };
    localStorage.setItem('user', JSON.stringify({ _id: '1', username: 'test' }));
    sessionStorage.setItem('token', 'abc');
    await act(async () => {
      useStore.getState().hydrate();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect((window as any).mlc.getManySettings).toHaveBeenCalled();
    expect((window as any).mlc.getSession).toHaveBeenCalled();
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
    api.fetchNoteChanges.mockResolvedValueOnce({
      items: [
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
      ],
      serverTime: new Date().toISOString(),
    });

    await act(async () => {
      await useStore.getState().fetchNotes();
    });

    const state = useStore.getState();
    expect(state.notes[0]?.type).toBe('project');
  });

  it('should dedupe concurrent fetchNotes calls', async () => {
    const { api } = require('../services/api');
    let resolveFetch: ((value: { items: any[]; serverTime: string }) => void) | null = null;
    api.fetchNoteChanges.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const first = useStore.getState().fetchNotes();
    const second = useStore.getState().fetchNotes();

    await Promise.resolve();
    expect(api.fetchNoteChanges).toHaveBeenCalledTimes(1);

    resolveFetch?.({ items: [], serverTime: new Date().toISOString() });
    await act(async () => {
      await Promise.all([first, second]);
    });
  });

  it('should dedupe concurrent refreshCollections calls', async () => {
    const { api } = require('../services/api');
    api.fetchNoteChanges.mockResolvedValueOnce({ items: [], serverTime: new Date().toISOString() });
    api.fetchTaskChanges.mockResolvedValueOnce({ items: [], serverTime: new Date().toISOString() });

    await act(async () => {
      await Promise.all([
        useStore.getState().refreshCollections({ force: true }),
        useStore.getState().refreshCollections({ force: true }),
      ]);
    });

    expect(api.fetchNoteChanges).toHaveBeenCalledTimes(1);
    expect(api.fetchTaskChanges).toHaveBeenCalledTimes(1);
  });

  it('should replace optimistic note state with server state on sync conflict', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    const serverUpdatedAt = new Date(Date.now() + 1_000).toISOString();
    useStore.setState({
      notes: [
        { _id: 'note-1', title: 'Lokal', content: 'Innehall', type: 'note', locked: false, tags: [], createdAt: now, updatedAt: now } as any,
      ],
      unlockedProtectedNoteIds: [],
    } as any);
    api.updateNote.mockRejectedValueOnce({
      status: 409,
      code: 'SYNC_CONFLICT',
      details: {
        code: 'SYNC_CONFLICT',
        item: {
          _id: 'note-1',
          title: 'Serverversion',
          content: 'Fjarrversion',
          type: 'note',
          locked: false,
          tags: [],
          createdAt: now,
          updatedAt: serverUpdatedAt,
        },
      },
    });

    await act(async () => {
      await useStore.getState().updateNote('note-1', { title: 'Min andring' } as any);
    });

    const note = useStore.getState().notes.find((item) => item._id === 'note-1');
    expect(note?.title).toBe('Serverversion');
    expect(note?.content).toBe('Fjarrversion');
    expect(useStore.getState().error).toBe('Anteckningen har ändrats på en annan enhet. Synka och granska innan du skriver över.');
    expect(useStore.getState().syncConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'note-1', entity: 'note', title: 'Serverversion' }),
    ]));
    expect(db.saveNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ _id: 'note-1', title: 'Serverversion', content: 'Fjarrversion' }),
      false,
    );
  });

  it('should replace optimistic task state with server state on sync conflict', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    const serverUpdatedAt = new Date(Date.now() + 1_000).toISOString();
    useStore.setState({
      tasks: [
        {
          _id: 'task-1',
          title: 'Lokal uppgift',
          description: 'Lokal beskrivning',
          completed: false,
          priority: 'medium',
          createdAt: now,
          updatedAt: now,
          parentNoteId: null,
        } as any,
      ],
      notes: [],
      unlockedProtectedNoteIds: [],
    } as any);
    api.updateTask.mockRejectedValueOnce({
      status: 409,
      code: 'SYNC_CONFLICT',
      details: {
        code: 'SYNC_CONFLICT',
        item: {
          _id: 'task-1',
          title: 'Serveruppgift',
          description: 'Fjarrbeskrivning',
          completed: true,
          priority: 'high',
          createdAt: now,
          updatedAt: serverUpdatedAt,
          parentNoteId: null,
        },
      },
    });

    await act(async () => {
      await useStore.getState().updateTask('task-1', { title: 'Min lokala andring', completed: true } as any);
    });

    const task = useStore.getState().tasks.find((item) => item._id === 'task-1');
    expect(task?.title).toBe('Serveruppgift');
    expect(task?.description).toBe('Fjarrbeskrivning');
    expect(task?.completed).toBe(true);
    expect(useStore.getState().error).toBe('Uppgiften har ändrats på en annan enhet. Synka och granska innan du skriver över.');
    expect(useStore.getState().syncConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'task-1', entity: 'task', title: 'Serveruppgift' }),
    ]));
    expect(db.saveTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ _id: 'task-1', title: 'Serveruppgift', description: 'Fjarrbeskrivning', completed: true }),
      false,
    );
  });

  it('should skip unchanged note writes during fetchNotes', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    api.fetchNoteChanges.mockResolvedValueOnce({
      items: [
        { _id: 'note-unchanged', title: 'A', content: '', type: 'note', locked: false, createdAt: now, updatedAt: now },
        { _id: 'note-changed', title: 'B', content: '', type: 'note', locked: false, createdAt: now, updatedAt: new Date(Date.now() + 1000).toISOString() },
      ],
      serverTime: new Date().toISOString(),
    });
    db.getNoteSyncIndex.mockResolvedValueOnce(new Map([['note-unchanged', now]]));

    await act(async () => {
      await useStore.getState().fetchNotes();
    });

    expect(db.saveNote).toHaveBeenCalledTimes(1);
    expect(db.saveNote).toHaveBeenCalledWith(expect.objectContaining({ _id: 'note-changed' }));
  });

  it('should preserve selected note on transient empty fetch result', async () => {
    const { api } = require('../services/api');
    const now = new Date().toISOString();
    useStore.setState({
      selectedNoteId: 'n1',
      notes: [
        { _id: 'n1', title: 'Anteckning', content: 'Innehåll', type: 'note', locked: false, createdAt: now, updatedAt: now } as any,
      ],
    } as any);
    api.fetchNoteChanges.mockResolvedValueOnce({ items: [], serverTime: new Date().toISOString() });

    await act(async () => {
      await useStore.getState().fetchNotes();
    });

    expect(useStore.getState().selectedNoteId).toBe('n1');
  });

  it('should remove deleted note ids from delta sync results', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    useStore.setState({
      notes: [
        { _id: 'note-delete', title: 'Ta bort', content: '', type: 'note', locked: false, createdAt: now, updatedAt: now } as any,
      ],
      tasks: [
        { _id: 'task-under-note', title: 'Uppgift', description: '', completed: false, priority: 'medium', parentNoteId: 'note-delete', createdAt: now, updatedAt: now } as any,
      ],
      syncConflicts: [
        { key: 'note:note-delete', entity: 'note', itemId: 'note-delete', title: 'Ta bort', message: 'Konflikt', occurredAt: Date.now() },
      ],
    } as any);
    api.fetchNoteChanges.mockResolvedValueOnce({
      items: [],
      deletedIds: ['note-delete'],
      serverTime: new Date().toISOString(),
    });

    await act(async () => {
      await useStore.getState().fetchNotes();
    });

    expect(useStore.getState().notes).toEqual([]);
    expect(useStore.getState().tasks).toEqual([]);
    expect(useStore.getState().syncConflicts).toEqual([]);
    expect(db.deleteNote).toHaveBeenCalledWith('note-delete');
  });

  it('should bulk sync pending notes and tasks with temp id remapping', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    db.getPendingSyncNotes.mockResolvedValueOnce([
      { _id: 'temp-note', title: 'Ny anteckning', content: 'Lokalt', type: 'note', order: 0, pendingSync: true },
    ]);
    db.getPendingSyncTasks.mockResolvedValueOnce([
      { _id: 'temp-task', title: 'Ny task', description: '', completed: false, priority: 'medium', parentNoteId: 'temp-note', pendingSync: true },
    ]);
    api.syncNotes.mockResolvedValueOnce({
      results: [
        {
          clientOperationId: 'NOTE:temp-note',
          action: 'CREATE',
          entity: 'NOTE',
          status: 'applied',
          tempId: 'temp-note',
          itemId: 'note-real',
          item: { _id: 'note-real', title: 'Ny anteckning', content: 'Lokalt', type: 'note', order: 0, locked: false, createdAt: now, updatedAt: now },
        },
      ],
      serverTime: now,
    });
    api.syncTasks.mockResolvedValueOnce({
      results: [
        {
          clientOperationId: 'TASK:temp-task',
          action: 'CREATE',
          entity: 'TASK',
          status: 'applied',
          tempId: 'temp-task',
          itemId: 'task-real',
          item: { _id: 'task-real', title: 'Ny task', description: '', completed: false, priority: 'medium', parentNoteId: 'note-real', createdAt: now, updatedAt: now, position: 0 },
        },
      ],
      serverTime: now,
    });
    useStore.setState({
      notes: [{ _id: 'temp-note', title: 'Ny anteckning', content: 'Lokalt', type: 'note', order: 0, locked: false, createdAt: now, updatedAt: now } as any],
      tasks: [{ _id: 'temp-task', title: 'Ny task', description: '', completed: false, priority: 'medium', parentNoteId: 'temp-note', createdAt: now, updatedAt: now, position: 0 } as any],
    } as any);

    await act(async () => {
      await useStore.getState().syncOfflineChanges();
    });

    expect(api.syncNotes).toHaveBeenCalledWith([
      expect.objectContaining({ action: 'CREATE', tempId: 'temp-note' }),
    ]);
    expect(api.syncTasks).toHaveBeenCalledWith([
      expect.objectContaining({ action: 'CREATE', tempId: 'temp-task', data: expect.objectContaining({ parentNoteId: 'note-real' }) }),
    ]);
    expect(useStore.getState().notes).toEqual(expect.arrayContaining([expect.objectContaining({ _id: 'note-real' })]));
    expect(useStore.getState().tasks).toEqual(expect.arrayContaining([expect.objectContaining({ _id: 'task-real', parentNoteId: 'note-real' })]));
    expect(db.deleteNote).toHaveBeenCalledWith('temp-note');
    expect(db.deleteTask).toHaveBeenCalledWith('temp-task');
  });

  it('should skip unchanged task writes during fetchTasks', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    api.fetchTaskChanges.mockResolvedValueOnce({
      items: [
        { _id: 'task-unchanged', title: 'A', description: '', completed: false, priority: 'medium', createdAt: now, updatedAt: now, parentNoteId: null },
        { _id: 'task-changed', title: 'B', description: '', completed: false, priority: 'medium', createdAt: now, updatedAt: new Date(Date.now() + 1000).toISOString(), parentNoteId: null },
      ],
      serverTime: new Date().toISOString(),
    });
    db.getTaskSyncIndex.mockResolvedValueOnce(new Map([['task-unchanged', now]]));

    await act(async () => {
      await useStore.getState().fetchTasks();
    });

    expect(db.saveTask).toHaveBeenCalledTimes(1);
    expect(db.saveTask).toHaveBeenCalledWith(expect.objectContaining({ _id: 'task-changed' }));
  });

  it('should cascade project deletion through child notes, task lists and tasks', async () => {
    const { api } = require('../services/api');
    const { db } = require('../services/db');
    const now = new Date().toISOString();
    useStore.setState({
      notes: [
        { _id: 'project-1', title: 'Projekt', content: '', type: 'project', locked: false, parentId: null, createdAt: now, updatedAt: now } as any,
        { _id: 'list-1', title: 'Lista', content: '', type: 'task_list', locked: false, parentId: 'project-1', createdAt: now, updatedAt: now } as any,
        { _id: 'note-1', title: 'Anteckning', content: '', type: 'note', locked: false, parentId: 'project-1', createdAt: now, updatedAt: now } as any,
      ],
      tasks: [
        { _id: 'task-1', title: 'Uppgift', description: '', completed: false, priority: 'medium', parentNoteId: 'list-1', createdAt: now, updatedAt: now } as any,
      ],
      activeProjectId: 'project-1',
      selectedTaskListId: 'list-1',
      selectedNoteId: 'note-1',
      unlockedProtectedNoteIds: ['project-1', 'list-1'],
      transientUnlockedProtectedNoteIds: ['project-1'],
    } as any);
    api.deleteNote.mockResolvedValueOnce({ message: 'removed' });

    await act(async () => {
      await useStore.getState().deleteNote('project-1');
    });

    const state = useStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.activeProjectId).toBeNull();
    expect(state.selectedTaskListId).toBeNull();
    expect(state.selectedNoteId).toBeNull();
    expect(state.unlockedProtectedNoteIds).toEqual([]);
    expect(api.deleteNote).toHaveBeenCalledWith('project-1');
    expect(db.deleteNote).toHaveBeenCalledTimes(3);
    expect(db.deleteTask).toHaveBeenCalledWith('task-1');
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

  it('should not decrypt tasks that belong to locked project hierarchies', async () => {
    const { api } = require('../services/api');
    const now = new Date().toISOString();
    useStore.setState({
      notes: [
        { _id: 'p1', title: 'Projekt', content: '', type: 'project', parentId: null, locked: true, tags: [], createdAt: now, updatedAt: now } as any,
        { _id: 'n1', title: 'Barn', content: '', type: 'note', parentId: 'p1', locked: false, tags: [], createdAt: now, updatedAt: now } as any,
        { _id: 'n2', title: 'Fri', content: '', type: 'note', parentId: null, locked: false, tags: [], createdAt: now, updatedAt: now } as any,
      ],
      unlockedProtectedNoteIds: [],
    } as any);
    api.fetchTaskChanges.mockResolvedValueOnce({
      items: [
        { _id: 'task-locked', title: 'A', description: '', completed: false, priority: 'medium', createdAt: now, updatedAt: now, parentNoteId: 'n1' },
        { _id: 'task-open', title: 'B', description: '', completed: false, priority: 'medium', createdAt: now, updatedAt: now, parentNoteId: 'n2' },
      ],
      serverTime: new Date().toISOString(),
    });

    await act(async () => {
      await useStore.getState().fetchTasks();
    });

    expect(api.decryptTasks).toHaveBeenCalledWith([
      expect.objectContaining({ _id: 'task-open', parentNoteId: 'n2' }),
    ]);
    expect(useStore.getState().tasks.map((task) => task._id)).toEqual(['task-open']);
  });

  it('should keep the unlocked note readable after successful unlock inside locked hierarchy', async () => {
    const { api } = require('../services/api');
    const now = new Date().toISOString();
    useStore.setState({
      activeProjectId: 'p1',
      activeTab: 'notes',
      selectedNoteId: 'n1',
      notes: [
        { _id: 'p1', title: 'Projekt', content: '', type: 'project', parentId: null, locked: true, tags: [], createdAt: now, updatedAt: now } as any,
        { _id: 'n1', title: 'Låst anteckning', content: '', type: 'note', parentId: 'p1', locked: true, tags: [], createdAt: now, updatedAt: now } as any,
      ],
    } as any);
    api.verifyLock.mockResolvedValueOnce({
      success: true,
      unlockedId: 'p1',
      title: 'Barn',
      content: 'Hemlig text',
    });
    api.fetchNoteChanges.mockResolvedValueOnce({
      items: [
        { _id: 'p1', title: 'Projekt', content: '', type: 'project', parentId: null, locked: true, tags: [], createdAt: now, updatedAt: now },
        { _id: 'n1', title: 'Barn', content: 'Hemlig text', type: 'note', parentId: 'p1', locked: true, tags: [], createdAt: now, updatedAt: now },
      ],
      serverTime: new Date().toISOString(),
    });
    api.fetchTaskChanges.mockResolvedValueOnce({ items: [], serverTime: new Date().toISOString() });

    await act(async () => {
      const success = await useStore.getState().unlockNote('n1', 'secret');
      expect(success).toBe(true);
    });

    expect(useStore.getState().unlockedProtectedNoteIds).toEqual(expect.arrayContaining(['n1', 'p1']));
    expect(useStore.getState().notes.find((note) => note._id === 'n1')?.content).toBe('Hemlig text');
  });

  it('should relock unlocked protected note when leaving it', () => {
    const now = new Date().toISOString();
    useStore.setState({
      activeTab: 'notes',
      selectedNoteId: 'n1',
      unlockedProtectedNoteIds: ['n1'],
      notes: [
        { _id: 'n1', title: 'Hemlig', content: 'Text', type: 'note', parentId: null, locked: true, tags: [], createdAt: now, updatedAt: now } as any,
      ],
    } as any);

    act(() => {
      useStore.getState().selectNote(null);
    });

    const state = useStore.getState();
    expect(state.selectedNoteId).toBeNull();
    expect(state.unlockedProtectedNoteIds).toEqual([]);
    expect((state.notes[0] as any).locked).toBe(true);
    expect(state.notes[0]?.content).toBe('');
  });

});
