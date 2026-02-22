import { useStore } from '../stores/useStore';

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
  getSyncQueue: jest.fn().mockResolvedValue([]),
  removeFromSyncQueue: jest.fn(),
  addToSyncQueue: jest.fn(),
}));

jest.mock('../services/socket', () => {
  const socket = {
    connect: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connected: false,
  };

  return {
    socket,
    initSocket: jest.fn(() => socket),
    getSocket: jest.fn(() => socket),
    disconnectSocket: jest.fn(),
  };
});

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

  it('should refresh data on socket connect', async () => {
    const { fetchWithAuth } = require('../services/api');
    const { socket } = require('../services/socket');

    fetchWithAuth.mockResolvedValueOnce([]);
    fetchWithAuth.mockResolvedValueOnce([]);

    useStore.setState({
      token: 'abc',
    });

    useStore.getState().connectSocket();

    const connectHandler = socket.on.mock.calls.find((call: any[]) => call[0] === 'connect')?.[1];
    connectHandler();
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchWithAuth).toHaveBeenCalledWith('/notes');
    expect(fetchWithAuth).toHaveBeenCalledWith('/tasks');
  });
});
