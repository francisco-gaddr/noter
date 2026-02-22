import { act } from '@testing-library/react';
import { expect } from '@jest/globals';
import { useStore } from '../stores/useStore';

// Mocks
jest.mock('../services/api', () => ({
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
}));

jest.mock('../services/db', () => ({
  db: {
    saveNote: jest.fn(),
    deleteNote: jest.fn(),
    getAllNotes: jest.fn().mockResolvedValue([]),
    getPendingSyncNotes: jest.fn().mockResolvedValue([]),
    getPendingSyncTasks: jest.fn().mockResolvedValue([]),
    saveTask: jest.fn(),
    deleteTask: jest.fn(),
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

  it('should refresh data on socket connect', async () => {
    const { api } = require('../services/api');
    const { socket } = require('../services/socket');
    api.fetchNotes.mockResolvedValueOnce([]);
    api.fetchTasks.mockResolvedValueOnce([]);

    useStore.setState({
      user: { _id: '1', username: 'test', createdAt: new Date().toISOString() },
      token: 'abc',
    });

    act(() => {
      useStore.getState().initSocket();
    });

    const connectHandler = socket.on.mock.calls.find((call: any[]) => call[0] === 'connect')?.[1];
    await act(async () => {
      await connectHandler();
    });

    expect(api.fetchNotes).toHaveBeenCalled();
    expect(api.fetchTasks).toHaveBeenCalled();
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
});
