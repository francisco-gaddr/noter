import { Note, CreateNoteDto, UpdateNoteDto, Task, CreateTaskDto, UpdateTaskDto, encrypt, decrypt, AuthResponse } from '@repo/shared';

export const getUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const getBaseUrl = () => {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  // If envUrl is defined but contains localhost, and we are NOT on localhost, 
  // assume we should use relative path to allow Nginx to proxy correctly.
  if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) && 
      window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return '/api';
  }
  return envUrl || '/api';
};

const API_URL = getBaseUrl();

const getHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
};

const handleResponse = async (res: Response) => {
    if (res.status === 401) {
        throw new Error('Unauthorized');
    }
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err: any = new Error(data.message || 'Request failed');
        err.status = res.status;
        throw err;
    }
    return res.json();
};

const parseTaskCompleted = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    try {
      return decrypt(value) === 'true';
    } catch {
      return Boolean(value);
    }
  }
  return false;
};

const parseTaskPriority = (value: unknown): 'low' | 'medium' | 'high' => {
  const normalize = (v: unknown): 'low' | 'medium' | 'high' => {
    if (v === 'low' || v === 'medium' || v === 'high') return v;
    return 'medium';
  };

  if (typeof value === 'string') {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    try {
      return normalize(decrypt(value));
    } catch {
      return 'medium';
    }
  }
  return 'medium';
};

export const api = {
  // Auth
  async register(username: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse(res);
  },

  async login(username: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return handleResponse(res);
  },

  // Notes
  async fetchNotes(): Promise<Note[]> {
    const res = await fetch(`${API_URL}/notes`, { headers: getHeaders() });
    const notes: Note[] = await handleResponse(res);
    return notes.map(note => ({
      ...note,
      title: decrypt(note.title),
      content: decrypt(note.content),
      tags: note.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
      icon: note.icon ? (() => { try { return decrypt(note.icon) } catch { return note.icon } })() : undefined,
      type: note.type ? (() => { try { return decrypt(note.type) as any } catch { return note.type } })() : 'note',
      locked: note.locked ? decrypt(String(note.locked)) === 'true' : false,
      createdAt: decrypt(note.createdAt),
      updatedAt: decrypt(note.updatedAt),
    }));
  },

  async getNote(id: string): Promise<Note> {
    const res = await fetch(`${API_URL}/notes/${id}`, { headers: getHeaders() });
    const note: Note = await handleResponse(res);
    return {
        ...note,
        title: decrypt(note.title),
        content: decrypt(note.content),
        tags: note.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
        icon: note.icon ? (() => { try { return decrypt(note.icon) } catch { return note.icon } })() : undefined,
        type: note.type ? (() => { try { return decrypt(note.type) as any } catch { return note.type } })() : 'note',
        locked: note.locked ? decrypt(String(note.locked)) === 'true' : false,
        createdAt: decrypt(note.createdAt),
        updatedAt: decrypt(note.updatedAt),
    };
  },

  async createNote(data: CreateNoteDto): Promise<Note> {
    const encryptedData = {
      ...data,
      title: encrypt(data.title),
      content: encrypt(data.content),
      tags: data.tags?.map(t => encrypt(t)) ?? [],
      icon: data.icon ? encrypt(data.icon) : undefined,
      type: encrypt(data.type || 'note'),
      locked: encrypt(String(data.locked || false)),
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
    };
    
    const res = await fetch(`${API_URL}/notes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    return {
      ...note,
      title: decrypt(note.title),
      content: decrypt(note.content),
      tags: note.tags?.map(t => { try { return decrypt(t) } catch { return t } }) ?? [],
      icon: note.icon ? (() => { try { return decrypt(note.icon) } catch { return note.icon } })() : undefined,
      type: note.type ? (() => { try { return decrypt(note.type) as any } catch { return note.type } })() : 'note',
      locked: note.locked ? decrypt(String(note.locked)) === 'true' : false,
      createdAt: decrypt(note.createdAt),
      updatedAt: decrypt(note.updatedAt),
    };
  },

  async updateNote(id: string, data: UpdateNoteDto): Promise<Note> {
    const encryptedData = { ...data };
    if (data.title) encryptedData.title = encrypt(data.title);
    if (data.content) encryptedData.content = encrypt(data.content);
    if (data.locked !== undefined) encryptedData.locked = encrypt(String(data.locked));
    // Always update updatedAt
    encryptedData.updatedAt = encrypt(new Date().toISOString());

    const res = await fetch(`${API_URL}/notes/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const note: Note = await handleResponse(res);
    return {
      ...note,
      title: decrypt(note.title),
      content: decrypt(note.content),
      locked: note.locked ? decrypt(String(note.locked)) === 'true' : false,
      createdAt: decrypt(note.createdAt),
      updatedAt: decrypt(note.updatedAt),
    };
  },

  async verifyLock(id: string, password: string): Promise<{ success: boolean; content: string }> {
    const res = await fetch(`${API_URL}/notes/${id}/verify-lock`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ password }),
    });
    // Custom handling because verifyLock returns 401 for wrong password which is different from Unauthorized token
    if (res.status === 401 && res.url.includes('verify-lock')) {
         // Check if it's really invalid password or missing token
         // If token was missing/invalid, middleware would return 401.
         // But verifyLock endpoint logic returns 401 for wrong password too?
         // Let's check backend logic.
         // Backend: if (!isMatch) return res.status(401).json({ message: 'Invalid password' });
         // Middleware: if (!token) return res.status(401).json({ message: 'No token provided' });
         // We can check the message.
         const data = await res.json();
         if (data.message === 'Invalid password') {
             throw new Error('Invalid password');
         }
         throw new Error('Unauthorized');
    }
    
    if (!res.ok) {
       throw new Error('Failed to verify lock');
    }
    const data = await res.json();
    return {
      success: data.success,
      content: decrypt(data.content),
    };
  },

  async deleteNote(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/notes/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse(res);
  },

  // Tasks
  async fetchTasks(parentNoteId?: string): Promise<Task[]> {
    const url = parentNoteId ? `${API_URL}/tasks?parentNoteId=${parentNoteId}` : `${API_URL}/tasks`;
    const res = await fetch(url, { headers: getHeaders() });
    const tasks: any[] = await handleResponse(res);
    return tasks.map(task => ({
      ...task,
      title: decrypt(task.title),
      description: decrypt(task.description),
      completed: parseTaskCompleted(task.completed),
      priority: parseTaskPriority(task.priority),
      dueDate: task.dueDate ? (() => {
        try {
          const decrypted = decrypt(task.dueDate);
          const date = new Date(decrypted);
          return isNaN(date.getTime()) ? null : date;
        } catch {
          return null;
        }
      })() : null,
      createdAt: decrypt(task.createdAt),
      updatedAt: decrypt(task.updatedAt),
      position: task.position ? (() => {
        try {
          const decrypted = decrypt(String(task.position));
          const num = Number(decrypted);
          return isNaN(num) ? 0 : num;
        } catch {
          return 0;
        }
      })() : 0,
    }));
  },

  async createTask(data: CreateTaskDto): Promise<Task> {
    const encryptedData = {
      ...data,
      title: encrypt(data.title),
      description: data.description ? encrypt(data.description) : '',
      completed: encrypt(String(data.completed || false)),
      priority: encrypt(data.priority || 'medium'),
      dueDate: data.dueDate ? encrypt(new Date(data.dueDate).toISOString()) : '',
      createdAt: encrypt(new Date().toISOString()),
      updatedAt: encrypt(new Date().toISOString()),
      position: data.position !== undefined ? encrypt(String(data.position)) : encrypt('0'),
    };
    
    const res = await fetch(`${API_URL}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return {
      ...task,
      title: decrypt(task.title),
      description: decrypt(task.description),
      completed: parseTaskCompleted(task.completed),
      priority: parseTaskPriority(task.priority),
      dueDate: task.dueDate ? (() => {
        try {
          const decrypted = decrypt(task.dueDate);
          const date = new Date(decrypted);
          return isNaN(date.getTime()) ? null : date;
        } catch {
          return null;
        }
      })() : null,
      createdAt: decrypt(task.createdAt),
      updatedAt: decrypt(task.updatedAt),
      position: task.position ? (() => {
        try {
          const decrypted = decrypt(String(task.position));
          const num = Number(decrypted);
          return isNaN(num) ? 0 : num;
        } catch {
          return 0;
        }
      })() : 0,
    };
  },

  async updateTask(id: string, data: UpdateTaskDto): Promise<Task> {
    const encryptedData = { ...data } as any;
    if (data.title) encryptedData.title = encrypt(data.title);
    if (data.description) encryptedData.description = encrypt(data.description);
    if (data.completed !== undefined) encryptedData.completed = encrypt(String(data.completed));
    if (data.priority) encryptedData.priority = encrypt(data.priority);
    if (data.dueDate) encryptedData.dueDate = encrypt(new Date(data.dueDate).toISOString());
    encryptedData.updatedAt = encrypt(new Date().toISOString());
    if (data.position !== undefined) encryptedData.position = encrypt(String(data.position));

    const res = await fetch(`${API_URL}/tasks/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(encryptedData),
    });
    const task: any = await handleResponse(res);
    return {
      ...task,
      title: decrypt(task.title),
      description: decrypt(task.description),
      completed: parseTaskCompleted(task.completed),
      priority: parseTaskPriority(task.priority),
      dueDate: task.dueDate ? (() => {
        try {
          const decrypted = decrypt(task.dueDate);
          const date = new Date(decrypted);
          return isNaN(date.getTime()) ? null : date;
        } catch {
          return null;
        }
      })() : null,
      createdAt: decrypt(task.createdAt),
      updatedAt: decrypt(task.updatedAt),
      position: task.position ? (() => {
        try {
          const decrypted = decrypt(String(task.position));
          const num = Number(decrypted);
          return isNaN(num) ? 0 : num;
        } catch {
          return 0;
        }
      })() : 0,
    };
  },

  async deleteTask(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/tasks/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse(res);
  },

  async reorderTasks(tasks: { _id: string; position: number }[]): Promise<void> {
    const encryptedTasks = tasks.map(task => ({
      _id: task._id,
      position: encrypt(String(task.position))
    }));
    const res = await fetch(`${API_URL}/tasks/reorder`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ tasks: encryptedTasks }),
    });
    await handleResponse(res);
  },
 
   async assignTasksToList(noteId: string): Promise<void> {
     const res = await fetch(`${API_URL}/tasks/assign-to-list`, {
       method: 'PUT',
       headers: getHeaders(),
       body: JSON.stringify({ noteId }),
     });
     await handleResponse(res);
   },
};
