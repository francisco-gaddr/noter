import { encrypt, decrypt } from '@repo/shared';
import { api } from '../services/api';

// Mock fetch for API tests
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('E2E Encryption Tests', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    localStorage.clear();
  });

  describe('Field Encryption', () => {
    it('should encrypt and decrypt locked field correctly', () => {
      const originalValue = 'true';
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt createdAt field correctly', () => {
      const originalValue = new Date().toISOString();
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt updatedAt field correctly', () => {
      const originalValue = new Date().toISOString();
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });
  });

  describe('API E2E Encryption', () => {
    it('should encrypt locked field in createNote', async () => {
      const mockResponse = {
        _id: 'test-note-id',
        title: 'encrypted-title',
        content: 'encrypted-content',
        locked: 'encrypted-locked',
        createdAt: 'encrypted-createdAt',
        updatedAt: 'encrypted-updatedAt',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await api.createNote({
        title: 'Test Note',
        content: 'Test content',
        locked: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"locked":"') // Should be encrypted string
        })
      );
    });

    it('should decrypt locked field in fetchNotes', async () => {
      const encryptedTrue = encrypt('true');
      const encryptedFalse = encrypt('false');
      
      const mockResponse = [
        {
          _id: 'note-1',
          title: encrypt('Note 1'),
          content: encrypt('Content 1'),
          locked: encryptedTrue,
          createdAt: encrypt(new Date().toISOString()),
          updatedAt: encrypt(new Date().toISOString()),
        },
        {
          _id: 'note-2',
          title: encrypt('Note 2'),
          content: encrypt('Content 2'),
          locked: encryptedFalse,
          createdAt: encrypt(new Date().toISOString()),
          updatedAt: encrypt(new Date().toISOString()),
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await api.fetchNotes();

      expect(result[0].locked).toBe(true); // Should be decrypted to boolean
      expect(result[1].locked).toBe(false); // Should be decrypted to boolean
    });

    it('should decrypt timestamp fields correctly', async () => {
      const now = new Date().toISOString();
      const encryptedNow = encrypt(now);
      
      const mockResponse = [
        {
          _id: 'note-1',
          title: encrypt('Note 1'),
          content: encrypt('Content 1'),
          locked: encrypt('false'),
          createdAt: encryptedNow,
          updatedAt: encryptedNow,
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await api.fetchNotes();

      expect(result[0].createdAt).toBe(now);
      expect(result[0].updatedAt).toBe(now);
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed encrypted data gracefully', async () => {
      const mockResponse = [
        {
          _id: 'note-1',
          title: 'invalid-encrypted-data',
          content: 'invalid-encrypted-data',
          locked: 'invalid-encrypted-data',
          createdAt: 'invalid-encrypted-data',
          updatedAt: 'invalid-encrypted-data',
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await api.fetchNotes();

      // Should handle decryption errors gracefully
      expect(result[0].locked).toBe(false); // Default fallback
      expect(result[0].createdAt).toBe('invalid-encrypted-data'); // Should return original if decryption fails
      expect(result[0].updatedAt).toBe('invalid-encrypted-data'); // Should return original if decryption fails
    });

    it('should handle null/undefined encrypted fields', async () => {
      const mockResponse = [
        {
          _id: 'note-1',
          title: encrypt('Note 1'),
          content: encrypt('Content 1'),
          locked: null,
          createdAt: null,
          updatedAt: null,
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await api.fetchNotes();

      expect(result[0].locked).toBe(false); // Should handle null gracefully
      expect(result[0].createdAt).toBe(null);
      expect(result[0].updatedAt).toBe(null);
    });
  });

  describe('Security', () => {
    it('should not expose sensitive data in network requests', async () => {
      const sensitiveData = {
        title: 'My Secret Note',
        content: 'This is secret content',
        locked: true,
      };

      const mockResponse = {
        _id: 'test-note-id',
        title: encrypt(sensitiveData.title),
        content: encrypt(sensitiveData.content),
        locked: encrypt(String(sensitiveData.locked)),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-01T00:00:00.000Z'),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await api.createNote(sensitiveData);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body as string);

      // All sensitive fields should be encrypted in the request
      expect(requestBody.title).not.toBe(sensitiveData.title);
      expect(requestBody.content).not.toBe(sensitiveData.content);
      expect(requestBody.locked).not.toBe(sensitiveData.locked);

      // Should be able to decrypt back to original values
      expect(decrypt(requestBody.title)).toBe(sensitiveData.title);
      expect(decrypt(requestBody.content)).toBe(sensitiveData.content);
      expect(decrypt(requestBody.locked)).toBe(String(sensitiveData.locked));

      // Timestamps should be encrypted (API generates new ones)
      expect(requestBody.createdAt).toBeDefined();
      expect(requestBody.updatedAt).toBeDefined();
      expect(() => decrypt(requestBody.createdAt)).not.toThrow();
      expect(() => decrypt(requestBody.updatedAt)).not.toThrow();
    });
  });
});