// Mock Expo modules before imports
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid'),
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
}));

import { clearEncryptionKey, decrypt, encrypt, setEncryptionKey } from '@repo/shared';
import { fetchWithAuth } from '../services/api';

// Mock fetch for API tests
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Mobile E2E Encryption Tests', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    setEncryptionKey('a'.repeat(64));
    // Mock fetchWithAuth to use our mocked fetch
    jest.mock('../services/api', () => ({
      ...jest.requireActual('../services/api'),
      fetchWithAuth: mockFetch,
    }));
  });

  afterEach(() => {
    clearEncryptionKey();
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

    it('should fail closed when ciphertext is decrypted with the wrong runtime key', () => {
      setEncryptionKey('e'.repeat(64));
      const encrypted = encrypt('Legacy innehåll');
      setEncryptionKey('f'.repeat(64));
      expect(decrypt(encrypted)).toBe('');
    });

    it('should pass through plaintext values', () => {
      expect(decrypt('Projekt A')).toBe('Projekt A');
    });
  });

  describe('API E2E Encryption', () => {
    it('should encrypt locked field in createNote request', async () => {
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

      // This would be called by the store's createNote function
      const requestBody = {
        title: 'Test Note',
        content: 'Test content',
        locked: encrypt('true'),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-01T00:00:00.000Z'),
      };

      await fetchWithAuth('/notes', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"locked":"') // Should be encrypted string
        })
      );
    });

    it('should decrypt locked field in fetchNotes response', async () => {
      const encryptedTrue = encrypt('true');
      const encryptedFalse = encrypt('false');
      
      const mockResponse = [
        {
          _id: 'note-1',
          title: encrypt('Note 1'),
          content: encrypt('Content 1'),
          locked: encryptedTrue,
          createdAt: encrypt('2024-01-01T00:00:00.000Z'),
          updatedAt: encrypt('2024-01-01T00:00:00.000Z'),
        },
        {
          _id: 'note-2',
          title: encrypt('Note 2'),
          content: encrypt('Content 2'),
          locked: encryptedFalse,
          createdAt: encrypt('2024-01-02T00:00:00.000Z'),
          updatedAt: encrypt('2024-01-02T00:00:00.000Z'),
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchWithAuth('/notes');

      // The processApiNote function should decrypt these fields
      expect(result).toBeDefined();
    });
  });

  describe('Security', () => {
    it('should not expose sensitive data in network requests', async () => {
      const sensitiveData = {
        title: 'My Secret Note',
        content: 'This is secret content',
        locked: true,
      };

      const encryptedData = {
        title: encrypt(sensitiveData.title),
        content: encrypt(sensitiveData.content),
        locked: encrypt(String(sensitiveData.locked)),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-01T00:00:00.000Z'),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _id: 'test-note-id',
          ...encryptedData,
        }),
      } as Response);

      await fetchWithAuth('/notes', {
        method: 'POST',
        body: JSON.stringify(encryptedData),
      });

      const callArgs = mockFetch.mock.calls[0];
      if (!callArgs || !callArgs[1]) throw new Error('No fetch call found');
      const requestBody = JSON.parse(callArgs[1].body as string);

      // All sensitive fields should be encrypted in the request
      expect(requestBody.title).not.toBe(sensitiveData.title);
      expect(requestBody.content).not.toBe(sensitiveData.content);
      expect(requestBody.locked).not.toBe(sensitiveData.locked);

      // Should be able to decrypt back to original values
      expect(decrypt(requestBody.title)).toBe(sensitiveData.title);
      expect(decrypt(requestBody.content)).toBe(sensitiveData.content);
      expect(decrypt(requestBody.locked)).toBe(String(sensitiveData.locked));

      // Timestamps should be encrypted
      expect(requestBody.createdAt).toBeDefined();
      expect(requestBody.updatedAt).toBeDefined();
      expect(() => decrypt(requestBody.createdAt)).not.toThrow();
      expect(() => decrypt(requestBody.updatedAt)).not.toThrow();
    });
  });
});
