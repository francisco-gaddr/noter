import { useStore } from '../stores/useStore';
import { encrypt, decrypt } from '@repo/shared';

// Mocks
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  addEventListener: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/api', () => ({
  fetchWithAuth: jest.fn(),
  login: jest.fn(),
  register: jest.fn(),
  setAuthToken: jest.fn(),
  initApiUrl: jest.fn(),
  setUnauthorizedHandler: jest.fn(),
  API_URL: 'http://test',
}));

jest.mock('../services/database', () => ({
  initDatabase: jest.fn(),
  getNotesLocal: jest.fn().mockResolvedValue([]),
  saveNoteLocal: jest.fn(),
  deleteNoteLocal: jest.fn(),
  getTasksLocal: jest.fn().mockResolvedValue([]),
  saveTaskLocal: jest.fn(),
  deleteTaskLocal: jest.fn(),
  syncPendingChanges: jest.fn(),
}));

jest.mock('../services/socket', () => ({
  initSocket: jest.fn(() => null),
  disconnectSocket: jest.fn(),
  getSocket: jest.fn(() => null),
}));

describe('Mobile Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStore.setState({
      notes: [],
      tasks: [],
      securityLocked: false,
      unlockedProtectedNoteIds: [],
      token: null,
      isInitialized: false,
      error: null,
    });
  });

  it('should have initial state', () => {
    const state = useStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.securityLocked).toBe(false);
  });

  it('should persist active project selection', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    useStore.getState().setActiveProject('project-xyz');
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('activeProjectId', 'project-xyz');
    expect(useStore.getState().activeProjectId).toBe('project-xyz');
  });

  it('should normalize quoted active project selection', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    useStore.getState().setActiveProject('"project-quoted"');
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('activeProjectId', 'project-quoted');
    expect(useStore.getState().activeProjectId).toBe('project-quoted');
  });

  it('should relock unlocked project content when leaving project', async () => {
    useStore.setState({
      activeProjectId: 'project-1',
      unlockedProtectedNoteIds: ['project-1'],
      notes: [
        { _id: 'project-1', title: 'Projekt', content: '', type: 'project', parentId: null, locked: true, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any,
        { _id: 'note-1', title: 'Synlig titel', content: 'Synligt', type: 'note', parentId: 'project-1', locked: false, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any,
      ],
    });

    useStore.getState().setActiveProject(null);
    await Promise.resolve();

    const state = useStore.getState();
    expect(state.unlockedProtectedNoteIds).not.toContain('project-1');
    expect(state.notes.find((n: any) => n._id === 'note-1')?.locked).toBe(true);
  });

  it('should unlock and load data on login when security lock is active', async () => {
    const { login, fetchWithAuth } = require('../services/api');
    const encryptedNow = encrypt(new Date().toISOString());
    const encryptedFuture = encrypt(new Date(Date.now() + 3600000).toISOString());
    login.mockResolvedValueOnce({ token: 'abc' });
    fetchWithAuth.mockResolvedValueOnce([
      {
        _id: 'note-1',
        title: encrypt('Inläst not'),
        content: encrypt('Innehåll'),
        locked: encrypt('false'),
        type: encrypt('note'),
        createdAt: encryptedNow,
        updatedAt: encryptedNow,
      },
    ]);
    fetchWithAuth.mockResolvedValueOnce([
      {
        _id: 'task-1',
        title: encrypt('Inläst task'),
        description: encrypt('Beskrivning'),
        completed: encrypt('false'),
        priority: encrypt('medium'),
        dueDate: encryptedFuture,
        recurrenceType: encrypt('none'),
        recurrenceDays: encrypt('[]'),
        reminderEnabled: encrypt('false'),
        reminderOffsetMinutes: encrypt('[]'),
        position: encrypt('0'),
        createdAt: encryptedNow,
        updatedAt: encryptedNow,
      },
    ]);

    useStore.setState({ securityLocked: true, token: null });
    await useStore.getState().login('test', 'password');

    const state = useStore.getState();
    expect(state.securityLocked).toBe(false);
    expect(state.token).toBe('abc');
    expect(fetchWithAuth).toHaveBeenCalledWith('/notes');
    expect(fetchWithAuth).toHaveBeenCalledWith('/tasks');
  });

  it('should fetch notes from API when online', async () => {
    const { fetchWithAuth } = require('../services/api');
    const mockNotes = [{
      _id: '1',
      title: encrypt('Test Note'),
      content: encrypt('Content'),
      locked: encrypt('false'),
      type: encrypt('note'),
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    }];
    fetchWithAuth.mockResolvedValueOnce(mockNotes);

    await useStore.getState().fetchNotes();

    expect(fetchWithAuth).toHaveBeenCalledWith('/notes');
    const state = useStore.getState();
    expect(state.notes.length).toBe(1);
    expect(state.notes[0]._id).toBe('1');
  });

  it('should mask locked notes from API', async () => {
    const { fetchWithAuth } = require('../services/api');
    const mockNotes = [
      { 
        _id: '1', 
        title: encrypt('Secret Title'),
        content: encrypt('Secret Content'),
        locked: encrypt('true'),
        updatedAt: encrypt(new Date().toISOString()),
        createdAt: encrypt(new Date().toISOString()),
      }
    ];
    fetchWithAuth.mockResolvedValueOnce(mockNotes);

    await useStore.getState().fetchNotes();

    const state = useStore.getState();
    expect(state.notes[0].title).toBe('Låst anteckning');
    expect(state.notes[0].content).toBe('');
    expect(state.notes[0].locked).toBe(true);
  });

  it('should keep project name visible but mask all descendants under locked project', async () => {
    const { fetchWithAuth } = require('../services/api');
    const projectId = 'project-1';
    const mockNotes = [
      {
        _id: projectId,
        title: encrypt('Projekt A'),
        content: encrypt('Projekt-hemligt'),
        locked: encrypt('true'),
        type: encrypt('project'),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
      },
      {
        _id: 'child-1',
        title: encrypt('Barn-hemlig titel'),
        content: encrypt('Barn-hemligt innehåll'),
        parentId: encrypt(projectId),
        locked: encrypt('false'),
        type: encrypt('note'),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
      },
    ];
    fetchWithAuth.mockResolvedValueOnce(mockNotes);

    await useStore.getState().fetchNotes();

    const state = useStore.getState();
    const project = state.notes.find((n) => n._id === projectId) as any;
    const child = state.notes.find((n) => n._id === 'child-1') as any;

    expect(project.title).toBe('Låst projekt');
    expect(project.content).toBe('');
    expect(child.title).toBe('Låst anteckning');
    expect(child.content).toBe('');
    expect(child.__rawEncryptedTitle).toBe(mockNotes[1].title);
    expect(child.__rawEncryptedContent).toBe(mockNotes[1].content);
  });

  it('should fetch notes from Local DB when offline', async () => {
     const NetInfo = require('@react-native-community/netinfo');
     NetInfo.fetch.mockResolvedValueOnce({ isConnected: false });

     const Database = require('../services/database');
     const localNotes = [{
      _id: 'local_1',
      title: encrypt('Local Note'),
      content: encrypt('Content'),
      locked: encrypt('false'),
      type: encrypt('note'),
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
      __rawEncryptedTitle: encrypt('Local Note'),
      __rawEncryptedContent: encrypt('Content'),
      __rawEncryptedTags: encrypt('[]'),
    }];
     Database.getNotesLocal.mockResolvedValueOnce(localNotes);

     await useStore.getState().fetchNotes();

     expect(Database.getNotesLocal).toHaveBeenCalled();
     const state = useStore.getState();
     expect(state.notes.length).toBe(1);
     expect(state.notes[0]._id).toBe('local_1');
  });

  it('should unlock note content without logging out', async () => {
    const { fetchWithAuth } = require('../services/api');
    const noteId = 'locked-1';
    const encryptedTitle = encrypt('Unlock Title');
    const encryptedContent = encrypt('Unlock Content');

    useStore.setState({
      notes: [{ _id: noteId, title: 'Låst anteckning', content: '', locked: true } as any],
    });

    fetchWithAuth.mockResolvedValueOnce({
      success: true,
      title: encryptedTitle,
      content: encryptedContent,
    });

    const result = await useStore.getState().verifyNoteLock(noteId, 'secret');

    expect(fetchWithAuth).toHaveBeenCalledWith(`/notes/${noteId}/verify-lock`, {
      method: 'POST',
      body: JSON.stringify({ password: 'secret' }),
      skipUnauthorized: true,
    });
    expect(result.title).toBe('Unlock Title');
    expect(result.content).toBe('Unlock Content');
  });

  it('should reject incorrect note password without clearing session', async () => {
    const { fetchWithAuth } = require('../services/api');
    const noteId = 'locked-2';

    fetchWithAuth.mockRejectedValueOnce({ status: 401 });

    await expect(useStore.getState().verifyNoteLock(noteId, 'wrong')).rejects.toThrow('Incorrect password');
  });

  it('should send password on lock update and mask content', async () => {
    const { fetchWithAuth } = require('../services/api');
    const noteId = 'note-1';
    const encryptedTitle = encrypt('Test Title');
    const encryptedContent = encrypt('Test Content');
    const encryptedTrue = encrypt('true');

    useStore.setState({
      notes: [{ _id: noteId, title: 'Test Title', content: 'Test Content', locked: false } as any],
    });

    fetchWithAuth.mockResolvedValueOnce({
      _id: noteId,
      title: encryptedTitle,
      content: encryptedContent,
      locked: encryptedTrue,
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    });

    await useStore.getState().updateNote(noteId, { locked: true, password: 'secret' });

    const body = JSON.parse(fetchWithAuth.mock.calls[0][1].body);
    expect(body.password).toBe('secret');

    const state = useStore.getState();
    const updated = state.notes.find(n => n._id === noteId);
    expect(updated?.title).toBe('Låst anteckning');
    expect(updated?.content).toBe('');
    const Database = require('../services/database');
    const optimisticSaved = Database.saveNoteLocal.mock.calls[0]?.[0];
    expect(decrypt(optimisticSaved.__rawEncryptedTitle)).toBe('Test Title');
    expect(decrypt(optimisticSaved.__rawEncryptedContent)).toBe('Test Content');
  });
});
