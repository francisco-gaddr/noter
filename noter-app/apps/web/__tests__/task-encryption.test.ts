import { clearEncryptionKey, decrypt, encrypt, setEncryptionKey } from '@repo/shared';
import { api } from '../services/api';

// Mock fetch for API tests
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Task E2E Encryption Tests', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    localStorage.clear();
    setEncryptionKey('a'.repeat(64));
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  describe('Task Field Encryption', () => {
    it('should encrypt and decrypt task position correctly', () => {
      const originalValue = '5';
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt task createdAt field correctly', () => {
      const originalValue = new Date().toISOString();
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt task updatedAt field correctly', () => {
      const originalValue = new Date().toISOString();
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt task title field correctly', () => {
      const originalValue = 'Test Task Title';
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt task description field correctly', () => {
      const originalValue = 'Test task description content';
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt task completed field correctly', () => {
      const originalValue = 'true';
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt task priority field correctly', () => {
      const originalValue = 'high';
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });

    it('should encrypt and decrypt task dueDate field correctly', () => {
      const originalValue = new Date().toISOString();
      const encrypted = encrypt(originalValue);
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(originalValue);
      expect(decrypted).toBe(originalValue);
    });
  });

  describe('Task API E2E Encryption', () => {
    it('should encrypt all task fields in createTask', async () => {
      const mockResponse = {
        _id: 'test-task-id',
        title: 'encrypted-title',
        description: 'encrypted-description',
        completed: 'encrypted-completed',
        priority: 'encrypted-priority',
        dueDate: 'encrypted-dueDate',
        createdAt: 'encrypted-createdAt',
        updatedAt: 'encrypted-updatedAt',
        position: 'encrypted-position',
        parentNoteId: null,
        parentId: null
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await api.createTask({
        title: 'Test Task',
        description: 'Test description',
        completed: false,
        priority: 'medium',
        dueDate: '2024-01-01T00:00:00.000Z',
        position: 5,
        parentNoteId: null
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"title":"') // Should be encrypted string
        })
      );

      const callArgs = mockFetch.mock.calls[0]!;
      const requestOptions = callArgs[1] as RequestInit;
      const requestBody = JSON.parse(requestOptions.body as string);

      // All sensitive fields should be encrypted
      expect(requestBody.title).not.toBe('Test Task');
      expect(requestBody.description).not.toBe('Test description');
      expect(requestBody.completed).not.toBe('false');
      expect(requestBody.priority).not.toBe('medium');
      expect(requestBody.dueDate).not.toBe('2024-01-01T00:00:00.000Z');
      expect(requestBody.position).not.toBe('5');

      // Should be able to decrypt back to original values
      expect(decrypt(requestBody.title)).toBe('Test Task');
      expect(decrypt(requestBody.description)).toBe('Test description');
      expect(decrypt(requestBody.completed)).toBe('false');
      expect(decrypt(requestBody.priority)).toBe('medium');
      expect(decrypt(requestBody.dueDate)).toBe('2024-01-01T00:00:00.000Z');
      expect(decrypt(requestBody.position)).toBe('5');

      // Timestamps should be encrypted (API generates new ones)
      expect(requestBody.createdAt).toBeDefined();
      expect(requestBody.updatedAt).toBeDefined();
      expect(() => decrypt(requestBody.createdAt)).not.toThrow();
      expect(() => decrypt(requestBody.updatedAt)).not.toThrow();
    });

    it('should decrypt all task fields in fetchTasks', async () => {
      const now = new Date().toISOString();
      const encryptedNow = encrypt(now);
      const encryptedTitle = encrypt('Task Title');
      const encryptedDescription = encrypt('Task Description');
      const encryptedCompleted = encrypt('false');
      const encryptedPriority = encrypt('medium');
      const encryptedDueDate = encrypt(now);
      const encryptedPosition = encrypt('5');
      
      const mockResponse = [
        {
          _id: 'task-1',
          title: encryptedTitle,
          description: encryptedDescription,
          completed: encryptedCompleted,
          priority: encryptedPriority,
          dueDate: encryptedDueDate,
          createdAt: encryptedNow,
          updatedAt: encryptedNow,
          position: encryptedPosition,
          parentNoteId: null,
          parentId: null
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const encrypted = await api.fetchTasks();
      const result = await api.decryptTasks(encrypted);

      const first = result[0]!;
      expect(first.title).toBe('Task Title');
      expect(first.description).toBe('Task Description');
      expect(first.completed).toBe(false);
      expect(first.priority).toBe('medium');
      expect(first.dueDate).toEqual(new Date(now));
      expect(first.createdAt).toBe(now);
      expect(first.updatedAt).toBe(now);
      expect(first.position).toBe(5);
    });

    it('should handle task reordering with encrypted position', async () => {
      const encryptedPosition1 = encrypt('1');
      const encryptedPosition2 = encrypt('2');
      
      // Mock the reorderTasks function - it returns void, not tasks
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      // This should not throw an error
      await expect(api.reorderTasks([
        { _id: 'task-1', position: 1 },
        { _id: 'task-2', position: 2 }
      ])).resolves.toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed encrypted task data gracefully', async () => {
      const mockResponse = [
        {
          _id: 'task-1',
          title: 'invalid-encrypted-data',
          description: 'invalid-encrypted-data',
          completed: 'invalid-encrypted-data',
          priority: 'invalid-encrypted-data',
          dueDate: 'invalid-encrypted-data',
          createdAt: 'invalid-encrypted-data',
          updatedAt: 'invalid-encrypted-data',
          position: 'invalid-encrypted-data',
          parentNoteId: null,
          parentId: null
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const encrypted = await api.fetchTasks();
      const result = await api.decryptTasks(encrypted);

      const first = result[0]!;
      expect(first.title).toBe('invalid-encrypted-data');
      expect(first.description).toBe('invalid-encrypted-data');
      expect(first.completed).toBe(false);
      expect(first.priority).toBe('medium');
      expect(first.dueDate).toBe(null);
      expect(first.position).toBe(0);
    });

    it('should handle null/undefined encrypted task fields', async () => {
      const mockResponse = [
        {
          _id: 'task-1',
          title: encrypt('Task Title'),
          description: null,
          completed: null,
          priority: null,
          dueDate: null,
          createdAt: null,
          updatedAt: null,
          position: null,
          parentNoteId: null,
          parentId: null
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const encrypted = await api.fetchTasks();
      const result = await api.decryptTasks(encrypted);

      const first = result[0]!;
      expect(first.title).toBe('Task Title');
      expect(first.description).toBe('');
      expect(first.completed).toBe(false);
      expect(first.priority).toBe('medium');
      expect(first.dueDate).toBe(null);
      expect(first.createdAt).toBe('');
      expect(first.updatedAt).toBe('');
      expect(first.position).toBe(0);
    });
  });

  describe('Security', () => {
    it('should not expose sensitive task data in network requests', async () => {
      const sensitiveData = {
        title: 'My Secret Task',
        description: 'This is secret task content',
        completed: true,
        priority: 'high' as const,
        dueDate: '2024-12-31T23:59:59.999Z',
        position: 10
      };

      const mockResponse = {
        _id: 'test-task-id',
        title: encrypt(sensitiveData.title),
        description: encrypt(sensitiveData.description),
        completed: encrypt(String(sensitiveData.completed)),
        priority: encrypt(sensitiveData.priority),
        dueDate: encrypt(sensitiveData.dueDate),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-01T00:00:00.000Z'),
        position: encrypt(String(sensitiveData.position)),
        parentNoteId: null,
        parentId: null
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await api.createTask(sensitiveData);

      const callArgs = mockFetch.mock.calls[0]!;
      const requestOptions = callArgs[1] as RequestInit;
      const requestBody = JSON.parse(requestOptions.body as string);

      // All sensitive fields should be encrypted in the request
      expect(requestBody.title).not.toBe(sensitiveData.title);
      expect(requestBody.description).not.toBe(sensitiveData.description);
      expect(requestBody.completed).not.toBe(String(sensitiveData.completed));
      expect(requestBody.priority).not.toBe(sensitiveData.priority);
      expect(requestBody.dueDate).not.toBe(sensitiveData.dueDate);
      expect(requestBody.position).not.toBe(String(sensitiveData.position));

      // Should be able to decrypt back to original values
      expect(decrypt(requestBody.title)).toBe(sensitiveData.title);
      expect(decrypt(requestBody.description)).toBe(sensitiveData.description);
      expect(decrypt(requestBody.completed)).toBe(String(sensitiveData.completed));
      expect(decrypt(requestBody.priority)).toBe(sensitiveData.priority);
      expect(decrypt(requestBody.dueDate)).toBe(sensitiveData.dueDate);
      expect(decrypt(requestBody.position)).toBe(String(sensitiveData.position));
    });
  });
});
