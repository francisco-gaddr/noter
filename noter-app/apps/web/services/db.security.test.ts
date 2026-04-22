import { encrypt } from '@repo/shared';

const memoryNotes = new Map<string, any>();
const memoryTasks = new Map<string, any>();

jest.mock('idb', () => ({
  openDB: jest.fn(async () => ({
    clear: async (store: string) => {
      if (store === 'notes') memoryNotes.clear();
      if (store === 'tasks') memoryTasks.clear();
    },
    getAll: async (store: string) => {
      if (store === 'notes') return Array.from(memoryNotes.values());
      if (store === 'tasks') return Array.from(memoryTasks.values());
      return [];
    },
    get: async (store: string, key: string) => {
      if (store === 'notes') return memoryNotes.get(key);
      if (store === 'tasks') return memoryTasks.get(key);
      return undefined;
    },
    put: async (store: string, value: any) => {
      if (store === 'notes') memoryNotes.set(value._id, value);
      if (store === 'tasks') memoryTasks.set(value._id, value);
    },
    delete: async (store: string, key: string) => {
      if (store === 'notes') memoryNotes.delete(key);
      if (store === 'tasks') memoryTasks.delete(key);
    },
  })),
}));

describe('web db note-at-rest security', () => {
  beforeEach(() => {
    memoryNotes.clear();
    memoryTasks.clear();
  });

  it('persists locked note with preserved encrypted raw payload and no plaintext leakage', async () => {
    const { db } = await import('./db');
    const rawTitle = encrypt('Superhemlig titel');
    const rawContent = encrypt('Superhemligt innehåll');
    const rawTag = encrypt('intern-tag');
    const rawIcon = encrypt('FaLock');

    await db.saveNote({
      _id: 'locked-1',
      userId: 'u1',
      title: 'Låst anteckning',
      content: '',
      tags: [],
      parentId: null,
      locked: true,
      icon: undefined,
      type: 'note' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      __rawEncryptedTitle: rawTitle,
      __rawEncryptedContent: rawContent,
      __rawEncryptedTags: [rawTag],
      __rawEncryptedIcon: rawIcon,
    } as any);

    const stored = memoryNotes.get('locked-1');
    expect(stored.title).toBe(rawTitle);
    expect(stored.content).toBe(rawContent);
    expect(stored.tags).toEqual([rawTag]);
    expect(stored.icon).toBe(rawIcon);
    expect(stored.title).not.toContain('Superhemlig titel');
    expect(stored.content).not.toContain('Superhemligt innehåll');

    const all = await db.getAllNotes();
    const roundTripped = all[0] as any;
    expect(roundTripped.title).toBe(rawTitle);
    expect(roundTripped.content).toBe(rawContent);
    expect(roundTripped.__rawEncryptedTitle).toBe(rawTitle);
    expect(roundTripped.__rawEncryptedContent).toBe(rawContent);
  });

  it('never stores plaintext even for unlocked note before/after local roundtrip', async () => {
    const { db } = await import('./db');
    const plaintextTitle = 'Vanlig titel';
    const plaintextContent = 'Vanligt innehåll';

    await db.saveNote({
      _id: 'plain-1',
      userId: 'u1',
      title: plaintextTitle,
      content: plaintextContent,
      tags: ['tagg-1'],
      parentId: null,
      locked: false,
      type: 'note' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const stored = memoryNotes.get('plain-1');
    expect(stored.title).not.toBe(plaintextTitle);
    expect(stored.content).not.toBe(plaintextContent);
    expect(stored.title).not.toContain(plaintextTitle);
    expect(stored.content).not.toContain(plaintextContent);

    const one = await db.getNote('plain-1');
    const local = one as any;
    expect(local.title).toBe(stored.title);
    expect(local.content).toBe(stored.content);
    expect(local.__rawEncryptedTitle).toBe(stored.title);
    expect(local.__rawEncryptedContent).toBe(stored.content);
  });

  it('stores tasks encrypted at rest without plaintext leakage', async () => {
    const { db } = await import('./db');
    const plaintextTitle = 'Task hemlig';
    const plaintextDescription = 'Task beskrivning hemlig';

    await db.saveTask({
      _id: 'task-1',
      userId: 'u1',
      title: plaintextTitle,
      description: plaintextDescription,
      completed: false,
      priority: 'high',
      dueDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentNoteId: null,
      parentId: null,
      position: 0,
      reminderEnabled: true,
      reminderOffsetMinutes: [0],
      recurrenceType: 'none',
      recurrenceDays: [],
    } as any);

    const stored = memoryTasks.get('task-1');
    expect(stored.title).not.toBe(plaintextTitle);
    expect(stored.description).not.toBe(plaintextDescription);
    expect(stored.title).not.toContain(plaintextTitle);
    expect(stored.description).not.toContain(plaintextDescription);

    const all = await db.getAllTasks();
    const task = all.find((item) => item._id === 'task-1');
    expect(task?.title).toBe(plaintextTitle);
    expect(task?.description).toBe(plaintextDescription);
  });

  it('keeps plaintext task cache entries readable instead of blanking them', async () => {
    const { db } = await import('./db');
    memoryTasks.set('task-plain-cache', {
      _id: 'task-plain-cache',
      userId: 'u1',
      title: 'Cache plain title',
      description: 'Cache plain description',
      completed: 'false',
      priority: 'medium',
      dueDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentNoteId: null,
      parentId: null,
      position: 0,
      pendingSync: 'false',
      deleted: 'false',
    });

    const all = await db.getAllTasks();
    const task = all.find((item) => item._id === 'task-plain-cache');
    expect(task?.title).toBe('Cache plain title');
    expect(task?.description).toBe('Cache plain description');
  });
});
