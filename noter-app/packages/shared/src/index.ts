export interface Note {
  _id: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  parentId: string | null;
  locked: boolean;
  password?: string;
  icon?: string;
  order?: number;
  type?: 'note' | 'task_list' | 'project';
  clientId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteDto {
  clientId?: string;
  title: string;
  content: string;
  tags?: string[];
  parentId?: string | null;
  locked?: boolean;
  password?: string;
  icon?: string;
  order?: number;
  type?: 'note' | 'task_list' | 'project';
}

export interface UpdateNoteDto {
  title?: string;
  content?: string;
  tags?: string[];
  parentId?: string | null;
  locked?: boolean | string;
  password?: string;
  icon?: string;
  order?: number;
  type?: 'note' | 'task_list' | 'project';
  updatedAt?: string;
}

export interface Task {
  _id: string;
  userId: string;
  clientId?: string;
  title: string;
  description: string;
  dueDate: string | null;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  parentNoteId: string | null;
  parentId?: string | null; // For subtasks
  position?: number;
  recurrenceType?: 'none' | 'daily' | 'weekly';
  recurrenceDays?: number[];
  reminderEnabled?: boolean;
  reminderOffsetMinutes?: 0 | 10;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedTask {
  _id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string | null;
  completed: string; // Encrypted boolean string
  priority: string; // Encrypted priority string
  parentNoteId: string | null;
  parentId?: string | null;
  position?: number;
  recurrenceType?: string;
  recurrenceDays?: string;
  reminderEnabled?: string;
  reminderOffsetMinutes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskDto {
  clientId?: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  parentNoteId?: string | null;
  parentId?: string | null;
  position?: number;
  recurrenceType?: 'none' | 'daily' | 'weekly';
  recurrenceDays?: number[];
  reminderEnabled?: boolean;
  reminderOffsetMinutes?: 0 | 10;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  dueDate?: string | null;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  parentNoteId?: string | null;
  parentId?: string | null;
  position?: number;
  recurrenceType?: 'none' | 'daily' | 'weekly';
  recurrenceDays?: number[];
  reminderEnabled?: boolean;
  reminderOffsetMinutes?: 0 | 10;
}

export interface User {
  _id: string;
  username: string;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export * from './encrypt';
