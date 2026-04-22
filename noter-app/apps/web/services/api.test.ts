const { encrypt, decrypt } = require('@repo/shared');
const { api, setApiBaseUrl } = require('./api');

// Mock the fetch function
global.fetch = jest.fn();

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

describe('E2E Encryption Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('test-token');
    const win: any = (globalThis as any).window || {};
    delete win.mlc;
    (globalThis as any).window = win;
  });

  it('restores browser session via refresh cookie and auth me', async () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'apiBaseUrl') return null;
      return null;
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'fresh-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ _id: 'u1', username: 'user', createdAt: '2024-01-01T00:00:00.000Z' }),
      });

    const restored = await api.restoreSession();
    expect(restored?.token).toBe('fresh-token');
    expect(restored?.user.username).toBe('user');
    expect((global.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    expect((global.fetch as jest.Mock).mock.calls[1][1]).toMatchObject({
      credentials: 'include',
    });
  });

  it('normalizes stored api base url', () => {
    setApiBaseUrl('https://example.com/app/api');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('apiBaseUrl', 'https://example.com/api');
  });

  it('appends api suffix for root backend urls', () => {
    setApiBaseUrl('https://example.com');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('apiBaseUrl', 'https://example.com/api');
  });

  it('uses electron main-process bridge for absolute external auth endpoints', async () => {
    const httpRequest = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ message: 'API endpoint not found' }),
    });
    const win: any = (globalThis as any).window || {};
    win.mlc = {
      isElectron: true,
      httpRequest,
    };
    (globalThis as any).window = win;
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'apiBaseUrl') return 'https://desktop.test/api';
      return null;
    });

    await expect(api.login('demo', 'secret')).rejects.toThrow('API endpoint not found');
    expect(httpRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://desktop.test/api/auth/login',
      method: 'POST',
    }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe('fetchNotes', () => {
    it('returns empty array for offline fallback payload', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ offline: true, message: 'You are offline' }),
      });

      await expect(api.fetchNotes()).resolves.toEqual([]);
    });

    it('should mask locked note content and title while keeping metadata', async () => {
      const mockNotes = [
        {
          _id: '1',
          title: encrypt('Test Note'),
          content: encrypt('Test content'),
          tags: [encrypt('tag1'), encrypt('tag2')],
          icon: encrypt('icon'),
          type: encrypt('note'),
          locked: encrypt('true'),
          createdAt: encrypt('2024-01-01T00:00:00.000Z'),
          updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
          parentId: null,
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const encryptedNotes = await api.fetchNotes();
      const notes = await api.decryptNotes(encryptedNotes);

      expect(notes).toHaveLength(1);
      expect(notes[0]).toEqual({
        _id: '1',
        title: 'Låst anteckning',
        content: '',
        tags: [],
        icon: undefined,
        type: 'note',
        locked: true,
        order: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        parentId: null,
      });
    });

    it('should handle false locked values correctly', async () => {
      const mockNotes = [
        {
          _id: '1',
          title: encrypt('Test Note'),
          content: encrypt('Test content'),
          tags: [],
          locked: encrypt('false'),
          createdAt: encrypt('2024-01-01T00:00:00.000Z'),
          updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const encryptedNotes = await api.fetchNotes();
      const notes = await api.decryptNotes(encryptedNotes);

      const first = notes[0]!;
      expect(first.locked).toBe(false);
    });

    it('should handle missing locked field gracefully', async () => {
      const mockNotes = [
        {
          _id: '1',
          title: encrypt('Test Note'),
          content: encrypt('Test content'),
          tags: [],
          // No locked field
          createdAt: encrypt('2024-01-01T00:00:00.000Z'),
          updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const encryptedNotes = await api.fetchNotes();
      const notes = await api.decryptNotes(encryptedNotes);

      const first = notes[0]!;
      expect(first.locked).toBe(false);
    });
  });

  describe('fetchTasks', () => {
    it('returns empty array for offline fallback payload', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ offline: true, message: 'You are offline' }),
      });

      await expect(api.fetchTasks()).resolves.toEqual([]);
    });

    it('keeps plaintext task title and description visible after decryptTasks', async () => {
      const tasks = await api.decryptTasks([
        {
          _id: 'task-1',
          title: 'Plain title',
          description: 'Plain description',
          completed: 'false',
          priority: 'medium',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          parentNoteId: null,
        },
      ]);

      expect(tasks[0]).toEqual(expect.objectContaining({
        title: 'Plain title',
        description: 'Plain description',
      }));
    });
  });

  describe('createNote', () => {
    it('should encrypt locked, createdAt, and updatedAt fields when creating a note', async () => {
      const createData = {
        title: 'Test Note',
        content: 'Test content',
        tags: ['tag1', 'tag2'],
        locked: true,
        parentId: null,
      };

      const mockResponse = {
        _id: '1',
        title: encrypt('Test Note'),
        content: encrypt('Test content'),
        tags: [encrypt('tag1'), encrypt('tag2')],
        locked: encrypt('true'),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      });

      const note = await api.createNote(createData);

      // Verify the request body was encrypted
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      
      expect(decrypt(requestBody.locked)).toBe('true');
      expect(new Date(decrypt(requestBody.createdAt)).toString()).not.toBe('Invalid Date');
      expect(new Date(decrypt(requestBody.updatedAt)).toString()).not.toBe('Invalid Date');

      // Verify the response was decrypted
      expect(note.locked).toBe(true);
      expect(note.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(note.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    it('should encrypt false locked values correctly', async () => {
      const createData = {
        title: 'Test Note',
        content: 'Test content',
        tags: [],
        locked: false,
      };

      const mockResponse = {
        _id: '1',
        title: encrypt('Test Note'),
        content: encrypt('Test content'),
        tags: [],
        locked: encrypt('false'),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      });

      await api.createNote(createData);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      
      expect(decrypt(requestBody.locked)).toBe('false');
    });
  });

  describe('updateNote', () => {
    it('should encrypt locked field when updating a note', async () => {
      const updateData = {
        title: 'Updated Note',
        content: 'Updated content',
        locked: true,
        password: 'secret',
      };

      const mockResponse = {
        _id: '1',
        title: encrypt('Updated Note'),
        content: encrypt('Updated content'),
        tags: [],
        locked: encrypt('true'),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const note = await api.updateNote('1', updateData);

      // Verify the request body was encrypted
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      
      expect(decrypt(requestBody.locked)).toBe('true');
      expect(requestBody.password).toBe('secret');

      // Verify the response was decrypted
      expect(note.locked).toBe(true);
      expect(note.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(note.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    });
  });

  describe('getNote', () => {
    it('should decrypt locked, createdAt, and updatedAt fields when fetching a single note', async () => {
      const mockNote = {
        _id: '1',
        title: encrypt('Test Note'),
        content: encrypt('Test content'),
        tags: [],
        locked: encrypt('true'),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNote,
      });

      const note = await api.getNote('1');

      expect(note.locked).toBe(true);
      expect(note.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(note.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    });
  });

  describe('Error Handling', () => {
    it('should handle decryption errors gracefully', async () => {
      const mockNotes = [
        {
          _id: '1',
          title: encrypt('Test Note'),
          content: encrypt('Test content'),
          tags: ['malformed-ciphertext'],
          locked: encrypt('true'),
          createdAt: encrypt('2024-01-01T00:00:00.000Z'),
          updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const encryptedNotes = await api.fetchNotes();
      const notes = await api.decryptNotes(encryptedNotes);

      const first = notes[0]!;
      expect(first.tags).toEqual([]);
      expect(first.locked).toBe(true);
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(api.fetchNotes()).rejects.toThrow('Network error');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' }),
      });

      await expect(api.fetchNotes()).rejects.toThrow('Server error');
    });
  });
});
