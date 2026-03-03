import { useStore } from '../stores/useStore';
import { encrypt } from '@repo/shared';

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

jest.mock('../services/api', () => ({
  fetchWithAuth: jest.fn(),
  login: jest.fn(),
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
  socket: {
    connect: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connected: false,
  },
}));

describe('Mobile Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStore.setState({
      notes: [],
      tasks: [],
    });
  });

  it('should have initial state', () => {
    const state = useStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it('should fetch notes from API when online', async () => {
    const { fetchWithAuth } = require('../services/api');
    const mockNotes = [{ _id: '1', title: 'Test Note', content: 'Content', updatedAt: new Date().toISOString() }];
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

  it('should fetch notes from Local DB when offline', async () => {
     const NetInfo = require('@react-native-community/netinfo');
     NetInfo.fetch.mockResolvedValueOnce({ isConnected: false });

     const Database = require('../services/database');
     const localNotes = [{ _id: 'local_1', title: 'Local Note', content: 'Content', updatedAt: new Date().toISOString() }];
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
  });
});
