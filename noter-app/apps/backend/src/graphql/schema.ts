import bcrypt from 'bcryptjs';
import { GraphQLBoolean, GraphQLInputObjectType, GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import Note from '../models/Note';
import Task from '../models/Task';
import { assertValidObjectId, deleteOwnedById, findOwnedById, findOwnedByIdAndUpdate } from '../utils/ownedQuery';

type ResolverContext = {
  userId?: string;
};

const BCRYPT_ROUNDS = Math.max(10, Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10) || 12);

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
    locked: { type: GraphQLString },
    password: { type: GraphQLString },
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
    completed: { type: GraphQLString },
    priority: { type: GraphQLString },
    parentNoteId: { type: GraphQLString },
    parentId: { type: GraphQLString },
    position: { type: GraphQLString },
    recurrenceType: { type: GraphQLString },
    recurrenceDays: { type: new GraphQLList(GraphQLString) },
    reminderEnabled: { type: GraphQLString },
    reminderOffsetMinutes: { type: GraphQLString },
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
    locked: { type: GraphQLString },
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
    completed: { type: GraphQLString },
    priority: { type: GraphQLString },
    parentNoteId: { type: GraphQLString },
    parentId: { type: GraphQLString },
    position: { type: GraphQLString },
    recurrenceType: { type: GraphQLString },
    recurrenceDays: { type: new GraphQLList(GraphQLString) },
    reminderEnabled: { type: GraphQLString },
    reminderOffsetMinutes: { type: GraphQLString },
    clientId: { type: GraphQLString },
    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
  }
});

const toNote = (note: any) => ({
  _id: note._id.toString(),
  userId: note.userId,
  clientId: note.clientId || null,
  title: note.title || '',
  content: note.content || '',
  tags: Array.isArray(note.tags) ? note.tags : [],
  parentId: note.parentId ? note.parentId.toString() : null,
  locked: note.locked || '',
  password: null,
  icon: note.icon || null,
  iconColor: note.iconColor || null,
  order: note.order || null,
  type: note.type || null,
  createdAt: note.createdAt || '',
  updatedAt: note.updatedAt || '',
});

const toTask = (task: any) => ({
  _id: task._id.toString(),
  userId: task.userId,
  clientId: task.clientId || null,
  title: task.title || '',
  description: task.description || '',
  dueDate: task.dueDate || null,
  completed: task.completed || '',
  priority: task.priority || null,
  parentNoteId: task.parentNoteId ? task.parentNoteId.toString() : null,
  parentId: task.parentId ? task.parentId.toString() : null,
  position: task.position || null,
  recurrenceType: task.recurrenceType || null,
  recurrenceDays: task.recurrenceDays ? String(task.recurrenceDays).split(',') : [],
  reminderEnabled: task.reminderEnabled || '',
  reminderOffsetMinutes: task.reminderOffsetMinutes || null,
  createdAt: task.createdAt || '',
  updatedAt: task.updatedAt || '',
});

const requireUser = (userId?: string | null) => {
  if (!userId) throw new Error('Unauthorized');
  return userId;
};

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    note: {
      type: NoteType,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const note = await findOwnedById(Note, userId, assertValidObjectId(args.id));
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
        const notes = await Note.find(filter).sort({ createdAt: -1 });
        const mapped = notes.map(toNote);
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
        const task = await findOwnedById(Task, userId, assertValidObjectId(args.id));
        return task ? toTask(task) : null;
      }
    },
    tasks: {
      type: new GraphQLList(TaskType),
      args: {
        parentNoteId: { type: GraphQLString },
        completed: { type: GraphQLString }
      },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const filter: any = { userId };
        if (args.parentNoteId !== undefined) filter.parentNoteId = args.parentNoteId || null;
        const tasks = await Task.find(filter).sort({ createdAt: -1 });
        const mapped = tasks.map(toTask);
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
        const passwordHash = input.password ? await bcrypt.hash(String(input.password), BCRYPT_ROUNDS) : '';
        const note = await Note.create({
          userId,
          clientId: input.clientId || '',
          title: input.title || '',
          content: input.content || '',
          tags: (input.tags || []).map((t: string) => String(t)),
          parentId: input.parentId || null,
          locked: input.locked || '',
          password: passwordHash,
          icon: input.icon || null,
          iconColor: input.iconColor || null,
          order: input.order || '',
          type: input.type || '',
          createdAt: input.createdAt || '',
          updatedAt: input.updatedAt || '',
        });
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
        const input = args.input;
        const update: any = {};
        if (input.title !== undefined) update.title = input.title;
        if (input.content !== undefined) update.content = input.content;
        if (input.tags !== undefined) update.tags = input.tags.map((t: string) => String(t));
        if (input.parentId !== undefined) update.parentId = input.parentId || null;
        if (input.locked !== undefined) update.locked = input.locked || '';
        if (input.password !== undefined) update.password = input.password ? await bcrypt.hash(String(input.password), BCRYPT_ROUNDS) : '';
        if (input.icon !== undefined) update.icon = input.icon || null;
        if (input.iconColor !== undefined) update.iconColor = input.iconColor || null;
        if (input.order !== undefined) update.order = input.order || '';
        if (input.type !== undefined) update.type = input.type || '';
        if (input.createdAt !== undefined) update.createdAt = input.createdAt || '';
        if (input.updatedAt !== undefined) update.updatedAt = input.updatedAt || '';

        const note = await findOwnedByIdAndUpdate(Note, userId, assertValidObjectId(args.id), { $set: update }, { new: true });
        return note ? toNote(note) : null;
      }
    },
    deleteNote: {
      type: GraphQLBoolean,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const res = await deleteOwnedById(Note, userId, assertValidObjectId(args.id));
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
          title: input.title || '',
          description: input.description || '',
          dueDate: input.dueDate || null,
          completed: input.completed || '',
          priority: input.priority || '',
          parentNoteId: input.parentNoteId || null,
          parentId: input.parentId || null,
          position: input.position || '',
          recurrenceType: input.recurrenceType || '',
          recurrenceDays: input.recurrenceDays ? input.recurrenceDays.join(',') : '',
          reminderEnabled: input.reminderEnabled || '',
          reminderOffsetMinutes: input.reminderOffsetMinutes || '',
          createdAt: input.createdAt || '',
          updatedAt: input.updatedAt || '',
        });
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
        const input = args.input;
        const update: any = {};
        if (input.title !== undefined) update.title = input.title;
        if (input.description !== undefined) update.description = input.description;
        if (input.dueDate !== undefined) update.dueDate = input.dueDate || null;
        if (input.completed !== undefined) update.completed = input.completed || '';
        if (input.priority !== undefined) update.priority = input.priority || '';
        if (input.parentNoteId !== undefined) update.parentNoteId = input.parentNoteId || null;
        if (input.parentId !== undefined) update.parentId = input.parentId || null;
        if (input.position !== undefined) update.position = input.position || '';
        if (input.recurrenceType !== undefined) update.recurrenceType = input.recurrenceType || '';
        if (input.recurrenceDays !== undefined) update.recurrenceDays = input.recurrenceDays ? input.recurrenceDays.join(',') : '';
        if (input.reminderEnabled !== undefined) update.reminderEnabled = input.reminderEnabled || '';
        if (input.reminderOffsetMinutes !== undefined) update.reminderOffsetMinutes = input.reminderOffsetMinutes || '';
        if (input.createdAt !== undefined) update.createdAt = input.createdAt || '';
        if (input.updatedAt !== undefined) update.updatedAt = input.updatedAt || '';

        const task = await findOwnedByIdAndUpdate(Task, userId, assertValidObjectId(args.id), { $set: update }, { new: true });
        return task ? toTask(task) : null;
      }
    },
    deleteTask: {
      type: GraphQLBoolean,
      args: { id: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_source: unknown, args: any, context: ResolverContext) => {
        const userId = requireUser(context.userId);
        const res = await deleteOwnedById(Task, userId, assertValidObjectId(args.id));
        return res.deletedCount > 0;
      }
    }
  }
});

export const toolSchema = new GraphQLSchema({
  query: QueryType,
  mutation: MutationType
});
