import { GraphQLBoolean, GraphQLInputObjectType, GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import mongoose from 'mongoose';
import Note from '../models/Note';
import Task from '../models/Task';
import { decrypt, encrypt, isAnyCiphertext, buildSecurityNoteMap, isReadableWithLocks, type SecurityNote } from '@repo/shared';

const decryptText = (value?: string | null) => {
  if (!value) return '';
  const decrypted = decrypt(value);
  return decrypted || value;
};

const decryptBool = (value?: string | null) => {
  if (!value) return false;
  const decrypted = decrypt(value);
  return (decrypted || value) === 'true';
};

const decryptNumber = (value?: string | null) => {
  if (!value) return null;
  const decrypted = decrypt(value) || value;
  const parsed = Number(decrypted);
  return Number.isFinite(parsed) ? parsed : null;
};

const encryptText = (value?: string | null) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value);
  // E2E preservation: if the client already encrypted this value with the USER's key
  // (true end-to-end — e.g. notes/tasks the AI agent creates now pre-encrypt title/
  // content/tags), pass the ciphertext through UNCHANGED. Never decrypt it (we can't —
  // we don't hold the user key) and never re-wrap it under the server key, which would
  // downgrade it to server-readable. Only genuinely plaintext fields get server-encrypted.
  if (isAnyCiphertext(s)) return s;
  return encrypt(s);
};

type ResolverContext = {
  userId?: string;
  tenant?: {
    orgId?: string;
    roles?: string[];
    scopes?: string[];
    plan?: string;
  };
  // socket.io server, passed through from the GraphQL HTTP handler so tool-use
  // mutations can broadcast the same realtime events the REST routes do.
  io?: { to?: (room: string) => { emit?: (event: string, payload: unknown) => void } };
};

const NoteType = new GraphQLObjectType({
  name: 'Note',
  fields: {
    _id: { type: new GraphQLNonNull(GraphQLString) },
    userId: { type: new GraphQLNonNull(GraphQLString) },
    clientId: { type: GraphQLString },
    title: { type: GraphQLString },
    content: { type: GraphQLString },
    tags: { type: new GraphQLList(GraphQLString) },
    parentId: { type: GraphQLString },
    locked: { type: GraphQLBoolean },
    // NOTE: the lock `password` is deliberately NOT an output field. Lock verification goes
    // through the REST `/api/notes/:id/verify-lock` endpoint only. Returning it here would
    // hand the (server-decryptable) lock password to any authenticated GraphQL client; the
    // lock guards already filter out every note carrying a lock signal, so dropping it is
    // defense-in-depth against a future forgotten guard.
    icon: { type: GraphQLString },
    iconColor: { type: GraphQLString },
    order: { type: GraphQLString },
    type: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
  }
});

const TaskType = new GraphQLObjectType({
  name: 'Task',
  fields: {
    _id: { type: new GraphQLNonNull(GraphQLString) },
    userId: { type: new GraphQLNonNull(GraphQLString) },
    clientId: { type: GraphQLString },
    title: { type: GraphQLString },
    description: { type: GraphQLString },
    dueDate: { type: GraphQLString },
    completed: { type: GraphQLBoolean },
    priority: { type: GraphQLString },
    parentNoteId: { type: GraphQLString },
    parentId: { type: GraphQLString },
    position: { type: GraphQLString },
    recurrenceType: { type: GraphQLString },
    recurrenceDays: { type: new GraphQLList(GraphQLString) },
    reminderEnabled: { type: GraphQLBoolean },
    reminderOffsetMinutes: { type: GraphQLString },
    aiAgent: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
  }
});

const NoteInput = new GraphQLInputObjectType({
  name: 'NoteInput',
  fields: {
    title: { type: GraphQLString },
    content: { type: GraphQLString },
    tags: { type: new GraphQLList(GraphQLString) },
    parentId: { type: GraphQLString },
    locked: { type: GraphQLBoolean },
    password: { type: GraphQLString },
    icon: { type: GraphQLString },
    iconColor: { type: GraphQLString },
    order: { type: GraphQLString },
    type: { type: GraphQLString },
    clientId: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
  }
});

const TaskInput = new GraphQLInputObjectType({
  name: 'TaskInput',
  fields: {
    title: { type: GraphQLString },
    description: { type: GraphQLString },
    dueDate: { type: GraphQLString },
    completed: { type: GraphQLBoolean },
    priority: { type: GraphQLString },
    parentNoteId: { type: GraphQLString },
    parentId: { type: GraphQLString },
    position: { type: GraphQLString },
    recurrenceType: { type: GraphQLString },
    recurrenceDays: { type: new GraphQLList(GraphQLString) },
    reminderEnabled: { type: GraphQLBoolean },
    reminderOffsetMinutes: { type: GraphQLString },
    aiAgent: { type: GraphQLString },
    clientId: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
  }
});

const toNote = (note: any) => ({
  _id: note._id.toString(),
  userId: note.userId,
  clientId: note.clientId || null,
  title: decryptText(note.title),
  content: decryptText(note.content),
  tags: Array.isArray(note.tags) ? note.tags.map((t: string) => decryptText(t)) : [],
  parentId: note.parentId ? note.parentId.toString() : null,
  locked: decryptBool(note.locked),
  // `password` intentionally omitted from the GraphQL projection — see NoteType.
  icon: note.icon ? decryptText(note.icon) : null,
  iconColor: note.iconColor ? decryptText(note.iconColor) : null,
  order: note.order ? decryptText(note.order) : null,
  type: note.type ? decryptText(note.type) : null,
  createdAt: decryptText(note.createdAt),
  updatedAt: decryptText(note.updatedAt),
});

const toTask = (task: any) => ({
  _id: task._id.toString(),
  userId: task.userId,
  clientId: task.clientId || null,
  title: decryptText(task.title),
  description: decryptText(task.description),
  dueDate: task.dueDate ? decryptText(task.dueDate) : null,
  completed: decryptBool(task.completed),
  priority: task.priority ? decryptText(task.priority) : null,
  parentNoteId: task.parentNoteId ? task.parentNoteId.toString() : null,
  parentId: task.parentId ? task.parentId.toString() : null,
  position: task.position ? decryptText(task.position) : null,
  recurrenceType: task.recurrenceType ? decryptText(task.recurrenceType) : null,
  recurrenceDays: task.recurrenceDays ? decryptText(task.recurrenceDays).split(',') : [],
  reminderEnabled: decryptBool(task.reminderEnabled),
  reminderOffsetMinutes: task.reminderOffsetMinutes ? decryptText(task.reminderOffsetMinutes) : null,
  aiAgent: task.aiAgent ? decryptText(task.aiAgent) : null,
  createdAt: decryptText(task.createdAt),
  updatedAt: decryptText(task.updatedAt),
});

const requireUser = (userId?: string | null) => {
  if (!userId) throw new Error('Unauthorized');
  return userId;
};

/**
 * SECURITY (locked-folder invariant): this GraphQL schema is the AI tool-use surface
 * (`toolSchema` at /api/graphql, also published as OpenAPI REST tools). The backend is
 * zero-knowledge and has NO unlock session, so — exactly like backendAgentRunner — it treats
 * ANY lock signal as locked: a note/folder with `hasLockSignal` (locked flag or a set password),
 * or anything under such a folder, must NEVER be returned to the tool caller. We build a
 * conservative security map from the raw (encrypted) docs (`+password`) and gate every read
 * with `isReadableWithLocks` using the EMPTY unlock set. Without this, a single `note(id)` /
 * `notes` / `task` / `tasks` query server-decrypts and leaks a locked note's content.
 */
const loadNoteSecurityMap = async (userId: string): Promise<Map<string, SecurityNote>> => {
  const rows = await Note.find({ userId }).select('+password').lean();
  const secNotes: SecurityNote[] = rows.map((n: any) => ({
    _id: String(n._id),
    parentId: n.parentId ? String(n.parentId) : null,
    locked: n.locked,
    password: n.password,
  }));
  return buildSecurityNoteMap(secNotes);
};

// Broadcast the same realtime events the REST routes emit, so an AI tool-use note/
// task (which goes through GraphQL) shows up live on the user's other clients —
// exactly as if the user had created it themselves.
const emitToUser = (context: ResolverContext, userId: string, event: string, payload: unknown) => {
  try { context.io?.to?.(`user:${userId}`)?.emit?.(event, payload); } catch { /* socket is best-effort */ }
};

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    note: {
      type: NoteType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        if (!mongoose.Types.ObjectId.isValid(args.id)) throw new Error('Invalid ID');
        // SECURITY: refuse locked notes (and anything under a locked folder) BEFORE decrypting.
        const secMap = await loadNoteSecurityMap(userId);
        if (!isReadableWithLocks(secMap.get(String(args.id)), secMap)) return null;
        const note = await Note.findOne({ _id: args.id, userId });
        return note ? toNote(note) : null;
      }
    },
    notes: {
      type: new GraphQLList(NoteType),
      args: {
        parentId: { type: GraphQLString },
        type: { type: GraphQLString }
      },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const filter: any = { userId };
        if (args.parentId !== undefined) filter.parentId = args.parentId || null;
        // SECURITY: drop every locked note (and notes under a locked folder) before decrypting.
        const secMap = await loadNoteSecurityMap(userId);
        const notes = await Note.find(filter).sort({ createdAt: -1 });
        const mapped = notes
          .filter((n: any) => isReadableWithLocks(secMap.get(String(n._id)), secMap))
          .map(toNote);
        if (args.type) {
          return mapped.filter((note) => note.type === args.type);
        }
        return mapped;
      }
    },
    task: {
      type: TaskType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        if (!mongoose.Types.ObjectId.isValid(args.id)) throw new Error('Invalid ID');
        const task = await Task.findOne({ _id: args.id, userId });
        if (!task) return null;
        // SECURITY: a task inherits its parent list/project lock state — refuse if locked.
        const secMap = await loadNoteSecurityMap(userId);
        if (task.parentNoteId && !isReadableWithLocks(secMap.get(String(task.parentNoteId)), secMap)) return null;
        return toTask(task);
      }
    },
    tasks: {
      type: new GraphQLList(TaskType),
      args: {
        parentNoteId: { type: GraphQLString },
        completed: { type: GraphQLBoolean }
      },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const filter: any = { userId };
        if (args.parentNoteId !== undefined) filter.parentNoteId = args.parentNoteId || null;
        // SECURITY: drop tasks whose parent list/project is locked before decrypting.
        const secMap = await loadNoteSecurityMap(userId);
        const tasks = await Task.find(filter).sort({ createdAt: -1 });
        const mapped = tasks
          .filter((t: any) => !t.parentNoteId || isReadableWithLocks(secMap.get(String(t.parentNoteId)), secMap))
          .map(toTask);
        if (args.completed !== undefined) {
          return mapped.filter((task) => task.completed === args.completed);
        }
        return mapped;
      }
    }
  }
});

const MutationType = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    createNote: {
      type: NoteType,
      args: { input: { type: new GraphQLNonNull(NoteInput) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const input = args.input;
        const note = await Note.create({
          userId,
          clientId: input.clientId || '',
          title: encryptText(input.title || 'Untitled'),
          content: encryptText(input.content || ''),
          tags: (input.tags || []).map((t: string) => encryptText(t)),
          parentId: input.parentId || null,
          locked: encryptText(String(!!input.locked)),
          password: input.password ? encryptText(input.password) : '',
          icon: input.icon ? encryptText(input.icon) : null,
          iconColor: input.iconColor ? encryptText(input.iconColor) : null,
          order: input.order ? encryptText(input.order) : '',
          type: input.type ? encryptText(input.type) : encryptText('note'),
          createdAt: encryptText(input.createdAt || new Date().toISOString()),
          updatedAt: encryptText(input.updatedAt || new Date().toISOString()),
        });
        // Emit the raw encrypted doc (same shape REST sends); clients safeDecrypt.
        emitToUser(context, userId, 'note:created', note);
        return toNote(note);
      }
    },
    updateNote: {
      type: NoteType,
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
        input: { type: new GraphQLNonNull(NoteInput) }
      },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        if (!mongoose.Types.ObjectId.isValid(args.id)) throw new Error('Invalid ID');
        const input = args.input;
        const update: any = {};
        if (input.title !== undefined) update.title = encryptText(input.title);
        if (input.content !== undefined) update.content = encryptText(input.content);
        if (input.tags !== undefined) update.tags = input.tags.map((t: string) => encryptText(t));
        if (input.parentId !== undefined) update.parentId = input.parentId || null;
        if (input.locked !== undefined) update.locked = encryptText(String(!!input.locked));
        if (input.password !== undefined) update.password = input.password ? encryptText(input.password) : '';
        if (input.icon !== undefined) update.icon = input.icon ? encryptText(input.icon) : null;
        if (input.iconColor !== undefined) update.iconColor = input.iconColor ? encryptText(input.iconColor) : null;
        if (input.order !== undefined) update.order = input.order ? encryptText(input.order) : '';
        if (input.type !== undefined) update.type = input.type ? encryptText(input.type) : encryptText('note');
        if (input.createdAt !== undefined) update.createdAt = encryptText(input.createdAt || new Date().toISOString());
        if (input.updatedAt !== undefined) update.updatedAt = encryptText(input.updatedAt || new Date().toISOString());

        const note = await Note.findOneAndUpdate({ _id: args.id, userId }, { $set: update }, { new: true });
        if (note) emitToUser(context, userId, 'note:updated', note);
        return note ? toNote(note) : null;
      }
    },
    deleteNote: {
      type: GraphQLBoolean,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        if (!mongoose.Types.ObjectId.isValid(args.id)) throw new Error('Invalid ID');
        const res = await Note.deleteOne({ _id: args.id, userId });
        if (res.deletedCount > 0) emitToUser(context, userId, 'note:deleted', args.id);
        return res.deletedCount > 0;
      }
    },
    createTask: {
      type: TaskType,
      args: { input: { type: new GraphQLNonNull(TaskInput) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const input = args.input;
        const task = await Task.create({
          userId,
          clientId: input.clientId || '',
          title: encryptText(input.title || ''),
          description: encryptText(input.description || ''),
          dueDate: input.dueDate ? encryptText(input.dueDate) : null,
          completed: encryptText(String(!!input.completed)),
          priority: input.priority ? encryptText(input.priority) : encryptText('medium'),
          parentNoteId: input.parentNoteId || null,
          parentId: input.parentId || null,
          position: input.position ? encryptText(input.position) : '',
          recurrenceType: input.recurrenceType ? encryptText(input.recurrenceType) : '',
          recurrenceDays: input.recurrenceDays ? encryptText(input.recurrenceDays.join(',')) : '',
          reminderEnabled: encryptText(String(!!input.reminderEnabled)),
          reminderOffsetMinutes: input.reminderOffsetMinutes ? encryptText(input.reminderOffsetMinutes) : '',
          aiAgent: input.aiAgent ? encryptText(input.aiAgent) : '',
          createdAt: encryptText(input.createdAt || new Date().toISOString()),
          updatedAt: encryptText(input.updatedAt || new Date().toISOString()),
        });
        emitToUser(context, userId, 'task:created', task);
        return toTask(task);
      }
    },
    updateTask: {
      type: TaskType,
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
        input: { type: new GraphQLNonNull(TaskInput) }
      },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        if (!mongoose.Types.ObjectId.isValid(args.id)) throw new Error('Invalid ID');
        const input = args.input;
        const update: any = {};
        if (input.title !== undefined) update.title = encryptText(input.title);
        if (input.description !== undefined) update.description = encryptText(input.description);
        if (input.dueDate !== undefined) update.dueDate = input.dueDate ? encryptText(input.dueDate) : null;
        if (input.completed !== undefined) update.completed = encryptText(String(!!input.completed));
        if (input.priority !== undefined) update.priority = input.priority ? encryptText(input.priority) : encryptText('medium');
        if (input.parentNoteId !== undefined) update.parentNoteId = input.parentNoteId || null;
        if (input.parentId !== undefined) update.parentId = input.parentId || null;
        if (input.position !== undefined) update.position = input.position ? encryptText(input.position) : '';
        if (input.recurrenceType !== undefined) update.recurrenceType = input.recurrenceType ? encryptText(input.recurrenceType) : '';
        if (input.recurrenceDays !== undefined) update.recurrenceDays = input.recurrenceDays ? encryptText(input.recurrenceDays.join(',')) : '';
        if (input.reminderEnabled !== undefined) update.reminderEnabled = encryptText(String(!!input.reminderEnabled));
        if (input.reminderOffsetMinutes !== undefined) update.reminderOffsetMinutes = input.reminderOffsetMinutes ? encryptText(input.reminderOffsetMinutes) : '';
        if (input.aiAgent !== undefined) update.aiAgent = input.aiAgent ? encryptText(input.aiAgent) : '';
        if (input.createdAt !== undefined) update.createdAt = encryptText(input.createdAt || new Date().toISOString());
        if (input.updatedAt !== undefined) update.updatedAt = encryptText(input.updatedAt || new Date().toISOString());

        const task = await Task.findOneAndUpdate({ _id: args.id, userId }, { $set: update }, { new: true });
        if (task) emitToUser(context, userId, 'task:updated', task);
        return task ? toTask(task) : null;
      }
    },
    deleteTask: {
      type: GraphQLBoolean,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        if (!mongoose.Types.ObjectId.isValid(args.id)) throw new Error('Invalid ID');
        const res = await Task.deleteOne({ _id: args.id, userId });
        if (res.deletedCount > 0) emitToUser(context, userId, 'task:deleted', args.id);
        return res.deletedCount > 0;
      }
    }
  }
});

export const toolSchema = new GraphQLSchema({
  query: QueryType,
  mutation: MutationType
});
