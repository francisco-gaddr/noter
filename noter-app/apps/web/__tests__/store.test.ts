import { act } from '@testing-library/react';
import { expect } from '@jest/globals';
import { useStore } from '../stores/useStore';

// Mocks
jest.mock('../services/api', () => ({
  getUUID: jest.fn(() => 'mock-uuid'),
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
    getAllNotes: jest.fn().mockResolvedValue([]),
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
});
