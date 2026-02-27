export interface Note {
  _id: string;
  userId: string;
  clientId?: string;
  title: string;
  content: string;
  tags: string[];
  parentId?: string | null;
  locked: boolean | string;
  password?: string;
  icon?: string;
  iconColor?: string;
  order?: number | string;
  type?: 'note' | 'task_list' | 'project';
  createdAt: string;
  updatedAt: string;
  deleted?: boolean | string;
}

export interface Task {
  _id: string;
  userId: string;
  clientId?: string;
  parentNoteId?: string;
  parentId?: string;
  title: string;
  completed: boolean;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string | null;
  recurrenceType?: 'none' | 'daily' | 'weekly';
  recurrenceDays?: number[];
  reminderEnabled?: boolean;
  reminderOffsetMinutes?: number;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean | string;
  position?: number;
}

export interface User {
  _id: string;
  id?: string;
  username: string;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateTaskDto {
  title?: string;
  completed?: boolean;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string | null;
  recurrenceType?: 'none' | 'daily' | 'weekly';
  recurrenceDays?: number[];
  reminderEnabled?: boolean;
  reminderOffsetMinutes?: number;
  parentNoteId?: string;
  position?: number;
}

export interface CreateTaskDto {
  title: string;
  completed?: boolean;
  parentNoteId?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string | null;
  recurrenceType?: 'none' | 'daily' | 'weekly';
  recurrenceDays?: number[];
  reminderEnabled?: boolean;
  reminderOffsetMinutes?: number;
  clientId?: string;
  position?: number;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface CreateNoteDto {
    title: string;
    content: string;
    tags?: string[];
    parentId?: string | null;
    type?: 'note' | 'task_list' | 'project';
    icon?: string;
    iconColor?: string;
    order?: number;
    locked?: boolean;
    clientId?: string;
}

export interface UpdateNoteDto {
    title?: string;
    content?: string;
    tags?: string[];
    parentId?: string | null;
    locked?: boolean;
    password?: string;
    icon?: string;
    iconColor?: string;
    type?: 'note' | 'task_list' | 'project';
    order?: number;
}

export interface AIModel {
  id: string;
  name: string;
  filename: string;
  path: string;
  size: number;
  quantization?: string;
  downloaded: boolean;
}

export interface Message {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt?: string;
  toolCalls?: any[];
  toolCallId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  model?: string;
}
