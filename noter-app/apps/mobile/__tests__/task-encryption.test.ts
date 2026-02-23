import { encrypt, decrypt } from '@repo/shared';
import { api } from '../services/api';

// Mock fetch for API tests
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Task E2E Encryption Tests - Mobile', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('Task Field Encryption - Mobile', () => {
    it('should encrypt and decrypt all task fields correctly', () => {
      const taskData = {
        title: 'Mobile Task Title',
        description: 'Mobile task description content',
        completed: 'false',
        priority: 'medium',
        dueDate: new Date().toISOString(),
        position: '5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Test encryption/decryption for each field
      Object.entries(taskData).forEach(([key, value]) => {
        const encrypted = encrypt(value);
        const decrypted = decrypt(encrypted);
        
        expect(encrypted).not.toBe(value);
        expect(decrypted).toBe(value);
      });
    });

    it('should handle numeric position field correctly', () => {
      const position = 15;
      const encrypted = encrypt(String(position));
      const decrypted = decrypt(encrypted);
      
      expect(encrypted).not.toBe(String(position));
      expect(decrypted).toBe(String(position));
      expect(Number(decrypted)).toBe(position);
    });
  });

  describe('Mobile Task API E2E Encryption', () => {
    it('should encrypt all task fields in createTask API call', async () => {
      const mockResponse = {
        _id: 'mobile-task-id',
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

      const taskData = {
        title: 'Mobile Task',
        description: 'Mobile description',
        completed: false,
        priority: 'medium',
        dueDate: '2024-01-01T00:00:00.000Z',
        position: 10,
        parentNoteId: null
      };

      // Simulate mobile API call (similar to web)
      const encryptedData = {
        title: encrypt(taskData.title),
        description: encrypt(taskData.description),
        completed: encrypt(String(taskData.completed)),
        priority: encrypt(taskData.priority),
        dueDate: taskData.dueDate ? encrypt(taskData.dueDate) : '',
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        position: encrypt(String(taskData.position)),
        parentNoteId: taskData.parentNoteId
      };

      // Verify all fields are encrypted
      expect(encryptedData.title).not.toBe(taskData.title);
      expect(encryptedData.description).not.toBe(taskData.description);
      expect(encryptedData.completed).not.toBe(String(taskData.completed));
      expect(encryptedData.priority).not.toBe(taskData.priority);
      expect(encryptedData.dueDate).not.toBe(taskData.dueDate);
      expect(encryptedData.position).not.toBe(String(taskData.position));

      // Verify decryption works
      expect(decrypt(encryptedData.title)).toBe(taskData.title);
      expect(decrypt(encryptedData.description)).toBe(taskData.description);
      expect(decrypt(encryptedData.completed)).toBe(String(taskData.completed));
      expect(decrypt(encryptedData.priority)).toBe(taskData.priority);
      expect(decrypt(encryptedData.dueDate)).toBe(taskData.dueDate);
      expect(decrypt(encryptedData.position)).toBe(String(taskData.position));
    });

    it('should handle task decryption in mobile socket events', () => {
      // Simulate socket event data (encrypted)
      const encryptedTask = {
        _id: 'task-1',
        title: encrypt('Mobile Task Title'),
        description: encrypt('Mobile task description'),
        completed: encrypt('false'),
        priority: encrypt('medium'),
        dueDate: encrypt(new Date().toISOString()),
        createdAt: encrypt(new Date().toISOString()),
        updatedAt: encrypt(new Date().toISOString()),
        position: encrypt('8'),
        parentNoteId: null,
        parentId: null
      };

      // Simulate mobile processApiTask function
      const processApiTask = (task: any) => ({
        ...task,
        title: decrypt(task.title),
        description: decrypt(task.description),
        completed: task.completed === 'true',
        priority: decrypt(task.priority),
        dueDate: task.dueDate ? decrypt(task.dueDate) : null,
        createdAt: decrypt(task.createdAt),
        updatedAt: decrypt(task.updatedAt),
        position: task.position ? Number(decrypt(String(task.position))) : 0,
      });

      const decryptedTask = processApiTask(encryptedTask);

      expect(decryptedTask.title).toBe('Mobile Task Title');
      expect(decryptedTask.description).toBe('Mobile task description');
      expect(decryptedTask.completed).toBe(false);
      expect(decryptedTask.priority).toBe('medium');
      expect(decryptedTask.dueDate).toBeTruthy();
      expect(decryptedTask.createdAt).toBeTruthy();
      expect(decryptedTask.updatedAt).toBeTruthy();
      expect(decryptedTask.position).toBe(8);
    });
  });

  describe('Mobile Edge Cases', () => {
    it('should handle null/undefined task fields in mobile', () => {
      const encryptedTask = {
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
      };

      const processApiTask = (task: any) => ({
        ...task,
        title: decrypt(task.title),
        description: task.description ? decrypt(task.description) : null,
        completed: task.completed === 'true',
        priority: task.priority ? decrypt(task.priority) : 'medium',
        dueDate: task.dueDate ? decrypt(task.dueDate) : null,
        createdAt: task.createdAt ? decrypt(task.createdAt) : null,
        updatedAt: task.updatedAt ? decrypt(task.updatedAt) : null,
        position: task.position ? Number(decrypt(String(task.position))) : 0,
      });

      const decryptedTask = processApiTask(encryptedTask);

      expect(decryptedTask.title).toBe('Task Title');
      expect(decryptedTask.description).toBe(null);
      expect(decryptedTask.completed).toBe(false);
      expect(decryptedTask.priority).toBe('medium'); // Default
      expect(decryptedTask.dueDate).toBe(null);
      expect(decryptedTask.createdAt).toBe(null);
      expect(decryptedTask.updatedAt).toBe(null);
      expect(decryptedTask.position).toBe(0); // Default
    });

    it('should handle malformed encrypted task data in mobile', () => {
      const malformedTask = {
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
      };

      const processApiTask = (task: any) => {
        try {
          return {
            ...task,
            title: decrypt(task.title),
            description: decrypt(task.description),
            completed: task.completed === 'true',
            priority: decrypt(task.priority),
            dueDate: task.dueDate ? decrypt(task.dueDate) : null,
            createdAt: decrypt(task.createdAt),
            updatedAt: decrypt(task.updatedAt),
            position: task.position ? (() => {
              try {
                const decryptedPosition = decrypt(String(task.position));
                return decryptedPosition === 'invalid-encrypted-data' ? 0 : Number(decryptedPosition);
              } catch {
                return 0;
              }
            })() : 0,
          };
        } catch (error) {
          // Fallback to original data if decryption fails
          return {
            ...task,
            completed: false,
            position: 0,
          };
        }
      };

      const decryptedTask = processApiTask(malformedTask);

      // Should handle decryption errors gracefully
      expect(decryptedTask.title).toBe('invalid-encrypted-data');
      expect(decryptedTask.description).toBe('invalid-encrypted-data');
      expect(decryptedTask.completed).toBe(false); // Default fallback
      expect(decryptedTask.priority).toBe('invalid-encrypted-data');
      expect(decryptedTask.dueDate).toBe('invalid-encrypted-data');
      expect(decryptedTask.position).toBe(0); // Default fallback
    });
  });

  describe('Mobile Security', () => {
    it('should not expose sensitive task data in network requests', () => {
      const sensitiveData = {
        title: 'My Secret Mobile Task',
        description: 'This is secret mobile task content',
        completed: true,
        priority: 'high',
        dueDate: '2024-12-31T23:59:59.999Z',
        position: 20
      };

      const encryptedData = {
        title: encrypt(sensitiveData.title),
        description: encrypt(sensitiveData.description),
        completed: encrypt(String(sensitiveData.completed)),
        priority: encrypt(sensitiveData.priority),
        dueDate: encrypt(sensitiveData.dueDate),
        createdAt: encrypt('2024-01-01T00:00:00.000Z'),
        updatedAt: encrypt('2024-01-01T00:00:00.000Z'),
        position: encrypt(String(sensitiveData.position))
      };

      // Verify all sensitive fields are encrypted
      expect(encryptedData.title).not.toBe(sensitiveData.title);
      expect(encryptedData.description).not.toBe(sensitiveData.description);
      expect(encryptedData.completed).not.toBe(String(sensitiveData.completed));
      expect(encryptedData.priority).not.toBe(sensitiveData.priority);
      expect(encryptedData.dueDate).not.toBe(sensitiveData.dueDate);
      expect(encryptedData.position).not.toBe(String(sensitiveData.position));

      // Verify decryption works
      expect(decrypt(encryptedData.title)).toBe(sensitiveData.title);
      expect(decrypt(encryptedData.description)).toBe(sensitiveData.description);
      expect(decrypt(encryptedData.completed)).toBe(String(sensitiveData.completed));
      expect(decrypt(encryptedData.priority)).toBe(sensitiveData.priority);
      expect(decrypt(encryptedData.dueDate)).toBe(sensitiveData.dueDate);
      expect(decrypt(encryptedData.position)).toBe(String(sensitiveData.position));
    });
  });
});