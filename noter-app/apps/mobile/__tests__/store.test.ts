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
  saveNotesLocalBulk: jest.fn().mockResolvedValue(undefined),
  deleteNoteLocal: jest.fn(),
  getTasksLocal: jest.fn().mockResolvedValue([]),
  saveTaskLocal: jest.fn(),
  saveTasksLocalBulk: jest.fn().mockResolvedValue(undefined),
  deleteTaskLocal: jest.fn(),
  syncPendingChanges: jest.fn(),
  getSyncQueue: jest.fn().mockResolvedValue([]),
  removeFromSyncQueue: jest.fn().mockResolvedValue(undefined),
  incrementSyncAttempt: jest.fn().mockResolvedValue(1),
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

  // SECURITY: backgrounding the app must re-lock every unlocked protected folder, so a note
  // inside a locked folder re-masks and cannot be read without re-entering the password.
  it('relockProtectedFolders re-locks unlocked folders and re-masks their notes (idempotent)', () => {
    const lockedFolder = { _id: 'lf', type: 'project', locked: true, title: 'Hemlig mapp', parentId: null };
    const child = { _id: 'c1', type: 'note', parentId: 'lf', title: 'Hemlig text', content: 'topphemligt' };
    useStore.setState({ notes: [lockedFolder, child] as any, unlockedProtectedNoteIds: ['lf'] });

    useStore.getState().relockProtectedFolders();

    const state = useStore.getState();
    expect(state.unlockedProtectedNoteIds).toEqual([]);
    const masked = state.notes.find((n: any) => n._id === 'c1') as any;
    expect(masked.title).toBe('Låst anteckning');
    expect(masked.content).toBe('');

    // Idempotent + free: a second call when nothing is unlocked is a no-op (same array ref).
    const before = useStore.getState().notes;
    useStore.getState().relockProtectedFolders();
    expect(useStore.getState().notes).toBe(before);
    expect(useStore.getState().unlockedProtectedNoteIds).toEqual([]);
  });

  // SECURITY (ADR-0012): app-lock must wipe the in-memory folder-key session, so a locked
  // folder is cryptographically re-locked (not just masked) when the app locks.
  it('clears the folder-key session on app-lock', async () => {
    const { setFolderKey, folderKeySessionSize } = require('@repo/shared');
    setFolderKey('proj-1', new Uint8Array(32).fill(9));
    expect(folderKeySessionSize()).toBe(1);
    await useStore.getState().setSecurityLocked(true);
    expect(folderKeySessionSize()).toBe(0);
  });

  // ADR-0012 read path: a v3f-sealed note inside an unlocked folder materialises decrypted when
  // the folder key is in the session, and stays masked (never shows ciphertext) without it.
  it('materializes a v3f note decrypted with the session folder key, masked without it', () => {
    const { clearAllFolderKeys, setFolderKey, wrapNoteForFolder, generateDataKey } = require('@repo/shared');
    clearAllFolderKeys();
    const key = generateDataKey();
    const sealedTitle = wrapNoteForFolder('Hemlig titel', key);
    const sealedBody = wrapNoteForFolder('Hemligt innehåll', key);
    const folder = { _id: 'lf', type: 'project', locked: true, title: 'Mapp', parentId: null };
    const other = { _id: 'lf2', type: 'project', locked: true, title: 'Mapp2', parentId: null };
    const note: any = {
      _id: 'n1', type: 'note', parentId: 'lf',
      title: sealedTitle, content: sealedBody,
      __rawEncryptedTitle: sealedTitle, __rawEncryptedContent: sealedBody,
    };
    // With the key → decrypts. setActiveProject('lf') drops lf2 from the unlock set, forcing a
    // re-materialize with unlock = {lf} (so the note is readable, not masked).
    setFolderKey('lf', key);
    useStore.setState({ notes: [folder, other, note] as any, unlockedProtectedNoteIds: ['lf', 'lf2'] });
    useStore.getState().setActiveProject('lf');
    let got = useStore.getState().notes.find((n: any) => n._id === 'n1') as any;
    expect(got.title).toBe('Hemlig titel');
    expect(got.content).toBe('Hemligt innehåll');

    // Without the key → masked, never the raw v3f envelope.
    clearAllFolderKeys();
    useStore.setState({ notes: [folder, other, note] as any, unlockedProtectedNoteIds: ['lf', 'lf2'] });
    useStore.getState().setActiveProject('lf');
    got = useStore.getState().notes.find((n: any) => n._id === 'n1') as any;
    expect(got.title).toBe('Låst anteckning');
    expect(got.content).toBe('');
    expect(got.title).not.toContain('v3f:');
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

  it('chunked decrypt: materializes a large note payload correctly across chunk boundaries', async () => {
    const { fetchWithAuth } = require('../services/api');
    // 137 notes forces multiple chunks (chunk size 50) plus a partial final chunk.
    const COUNT = 137;
    const mockNotes = Array.from({ length: COUNT }, (_, i) => ({
      _id: String(i),
      title: encrypt(`Note ${i}`),
      content: encrypt(`Content ${i}`),
      locked: encrypt('false'),
      type: encrypt('note'),
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    }));
    fetchWithAuth.mockResolvedValueOnce(mockNotes);

    await useStore.getState().fetchNotes();

    const state = useStore.getState();
    expect(state.notes.length).toBe(COUNT);
    // First, a boundary-crossing, and last item all decrypt — proving no chunk is dropped.
    expect(state.notes[0].title).toBe('Note 0');
    expect(state.notes[50].title).toBe('Note 50');
    expect(state.notes[COUNT - 1].title).toBe(`Note ${COUNT - 1}`);
    expect(state.isLoading).toBe(false);
  });

  it('chunked decrypt: materializes a large task payload correctly across chunk boundaries', async () => {
    const { fetchWithAuth } = require('../services/api');
    const COUNT = 120;
    const mockTasks = Array.from({ length: COUNT }, (_, i) => ({
      _id: String(i),
      title: encrypt(`Task ${i}`),
      description: encrypt(`Desc ${i}`),
      completed: encrypt('false'),
      priority: encrypt('medium'),
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    }));
    fetchWithAuth.mockResolvedValueOnce(mockTasks);

    await useStore.getState().fetchTasks();

    const state = useStore.getState();
    expect(state.tasks.length).toBe(COUNT);
    expect(state.tasks[0].title).toBe('Task 0');
    expect(state.tasks[60].title).toBe('Task 60');
    expect(state.tasks[COUNT - 1].title).toBe(`Task ${COUNT - 1}`);
    expect(state.isLoading).toBe(false);
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

    expect(project.title).toBe('Projekt A');
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

  it('offline-first: paints local notes even when the network refresh fails', async () => {
    const NetInfo = require('@react-native-community/netinfo');
    NetInfo.fetch.mockResolvedValueOnce({ isConnected: true });
    const { fetchWithAuth } = require('../services/api');
    fetchWithAuth.mockRejectedValueOnce(new Error('network down'));

    const Database = require('../services/database');
    Database.getNotesLocal.mockResolvedValueOnce([{
      _id: 'local_offline_1',
      title: encrypt('Cached Note'),
      content: encrypt('Cached'),
      locked: encrypt('false'),
      type: encrypt('note'),
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
      __rawEncryptedTitle: encrypt('Cached Note'),
      __rawEncryptedContent: encrypt('Cached'),
      __rawEncryptedTags: encrypt('[]'),
    }]);

    await useStore.getState().fetchNotes();

    const state = useStore.getState();
    // Local data is shown despite the failed refresh; spinner is off.
    expect(state.notes.map((n) => n._id)).toContain('local_offline_1');
    expect(state.isLoading).toBe(false);
  });

  it('offline-first: does not block on bulk-persist when online', async () => {
    const NetInfo = require('@react-native-community/netinfo');
    NetInfo.fetch.mockResolvedValueOnce({ isConnected: true });
    const { fetchWithAuth } = require('../services/api');
    fetchWithAuth.mockResolvedValueOnce([{
      _id: 'srv_1',
      title: encrypt('Server Note'),
      content: encrypt('Body'),
      locked: encrypt('false'),
      type: encrypt('note'),
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    }]);
    const Database = require('../services/database');

    await useStore.getState().fetchNotes();

    // Server snapshot is shown and persisted via the single-transaction bulk path.
    expect(useStore.getState().notes.map((n) => n._id)).toContain('srv_1');
    expect(Database.saveNotesLocalBulk).toHaveBeenCalled();
  });

  it('offline sync: drops a poison item after MAX attempts (persistent 5xx)', async () => {
    const Database = require('../services/database');
    const { fetchWithAuth } = require('../services/api');
    Database.getSyncQueue.mockResolvedValueOnce([
      { id: 7, action: 'CREATE', entity: 'NOTE', data: { title: 'enc', tempId: 'local_1' }, timestamp: new Date().toISOString(), attempts: 7 },
    ]);
    const err: any = new Error('server error'); err.status = 500;
    fetchWithAuth.mockRejectedValueOnce(err);
    Database.incrementSyncAttempt.mockResolvedValueOnce(8); // reaches MAX_SYNC_ATTEMPTS

    await useStore.getState().syncOfflineChanges();

    expect(Database.incrementSyncAttempt).toHaveBeenCalledWith(7);
    expect(Database.removeFromSyncQueue).toHaveBeenCalledWith(7);
  });

  it('offline sync: keeps a transiently-failed item below MAX attempts', async () => {
    const Database = require('../services/database');
    const { fetchWithAuth } = require('../services/api');
    Database.getSyncQueue.mockResolvedValueOnce([
      { id: 8, action: 'CREATE', entity: 'NOTE', data: { title: 'enc', tempId: 'local_2' }, timestamp: new Date().toISOString(), attempts: 1 },
    ]);
    fetchWithAuth.mockRejectedValueOnce(new Error('network down')); // no status → transient
    Database.incrementSyncAttempt.mockResolvedValueOnce(2);

    await useStore.getState().syncOfflineChanges();

    expect(Database.incrementSyncAttempt).toHaveBeenCalledWith(8);
    expect(Database.removeFromSyncQueue).not.toHaveBeenCalledWith(8);
  });

  it('offline sync: drops a permanent 4xx item immediately (not retried)', async () => {
    const Database = require('../services/database');
    const { fetchWithAuth } = require('../services/api');
    Database.getSyncQueue.mockResolvedValueOnce([
      { id: 9, action: 'UPDATE', entity: 'NOTE', data: { id: 'srv_9', title: 'enc' }, timestamp: new Date().toISOString(), attempts: 0 },
    ]);
    const err: any = new Error('bad request'); err.status = 400;
    fetchWithAuth.mockRejectedValueOnce(err);

    await useStore.getState().syncOfflineChanges();

    expect(Database.removeFromSyncQueue).toHaveBeenCalledWith(9);
    expect(Database.incrementSyncAttempt).not.toHaveBeenCalledWith(9);
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
