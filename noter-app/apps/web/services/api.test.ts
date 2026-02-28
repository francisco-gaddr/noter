import { encrypt, decrypt } from '@repo/shared';
import { api } from './api';

// Mock the fetch function
global.fetch = jest.fn();

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock as any;

// Mock the shared encryption functions
jest.mock('@repo/shared', () => ({
  encrypt: jest.fn((text: string) => `encrypted_${text}`),
  decrypt: jest.fn((ciphertext: string) => ciphertext.replace('encrypted_', '')),
}));

describe('E2E Encryption Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('test-token');
  });

  describe('fetchNotes', () => {
    it('should mask locked note content and title while keeping metadata', async () => {
      const mockNotes = [
        {
          _id: '1',
          title: 'encrypted_Test Note',
          content: 'encrypted_Test content',
          tags: ['encrypted_tag1', 'encrypted_tag2'],
          icon: 'encrypted_icon',
          type: 'encrypted_note',
          locked: 'encrypted_true',
          createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
          updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
          parentId: null,
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const notes = await api.fetchNotes();

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

      // Verify decryption was called for encrypted fields
      expect(decrypt).toHaveBeenCalledWith('encrypted_true');
      expect(decrypt).toHaveBeenCalledWith('encrypted_2024-01-01T00:00:00.000Z');
      expect(decrypt).toHaveBeenCalledWith('encrypted_2024-01-02T00:00:00.000Z');
    });

    it('should handle false locked values correctly', async () => {
      const mockNotes = [
        {
          _id: '1',
          title: 'encrypted_Test Note',
          content: 'encrypted_Test content',
          tags: [],
          locked: 'encrypted_false',
          createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
          updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const notes = await api.fetchNotes();

      const first = notes[0]!;
      expect(first.locked).toBe(false);
    });

    it('should handle missing locked field gracefully', async () => {
      const mockNotes = [
        {
          _id: '1',
          title: 'encrypted_Test Note',
          content: 'encrypted_Test content',
          tags: [],
          // No locked field
          createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
          updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const notes = await api.fetchNotes();

      const first = notes[0]!;
      expect(first.locked).toBe(false);
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
        title: 'encrypted_Test Note',
        content: 'encrypted_Test content',
        tags: ['encrypted_tag1', 'encrypted_tag2'],
        locked: 'encrypted_true',
        createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
        updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
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
      
      expect(requestBody.locked).toBe('encrypted_true');
      expect(requestBody.createdAt).toMatch(/^encrypted_/);
      expect(requestBody.updatedAt).toMatch(/^encrypted_/);

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
        title: 'encrypted_Test Note',
        content: 'encrypted_Test content',
        tags: [],
        locked: 'encrypted_false',
        createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
        updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      });

      await api.createNote(createData);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      
      expect(requestBody.locked).toBe('encrypted_false');
    });
  });

  describe('updateNote', () => {
    it('should encrypt locked field when updating a note', async () => {
      const updateData = {
        title: 'Updated Note',
        content: 'Updated content',
        locked: true,
      };

      const mockResponse = {
        _id: '1',
        title: 'encrypted_Updated Note',
        content: 'encrypted_Updated content',
        tags: [],
        locked: 'encrypted_true',
        createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
        updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
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
      
      expect(requestBody.locked).toBe('encrypted_true');

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
        title: 'encrypted_Test Note',
        content: 'encrypted_Test content',
        tags: [],
        locked: 'encrypted_true',
        createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
        updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
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
      // Mock decrypt to throw an error
      (decrypt as jest.Mock).mockImplementation((text: string) => {
        if (text === 'encrypted_malformed') {
          throw new Error('Decryption failed');
        }
        return text.replace('encrypted_', '');
      });

      const mockNotes = [
        {
          _id: '1',
          title: 'encrypted_Test Note',
          content: 'encrypted_Test content',
          tags: ['encrypted_malformed'], // This will fail to decrypt
          locked: 'encrypted_true',
          createdAt: 'encrypted_2024-01-01T00:00:00.000Z',
          updatedAt: 'encrypted_2024-01-02T00:00:00.000Z',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockNotes,
      });

      const notes = await api.fetchNotes();

      // Should fallback to original value when decryption fails
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
