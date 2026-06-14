import { cleanupCandidates } from './cleanup';
import type { Note, Task } from './types';

const note = (o: Partial<Note>): Note => ({ _id: o._id ?? 'n', userId: 'u', title: '', content: '', tags: [], locked: false, createdAt: '', updatedAt: '', ...o });
const task = (o: Partial<Task>): Task => ({ _id: o._id ?? 't', userId: 'u', title: '', completed: false, createdAt: '', updatedAt: '', ...o });

describe('cleanupCandidates', () => {
  it('buckets empty notes, blank tasks and completed tasks', () => {
    const notes = [note({ _id: 'empty' }), note({ _id: 'real', title: 'A' }), note({ _id: 'folder', type: 'project' })];
    const tasks = [task({ _id: 'blank' }), task({ _id: 'open', title: 'Open' }), task({ _id: 'done', title: 'Done', completed: true })];
    const c = cleanupCandidates(notes, tasks);
    expect(c.emptyNotes.map((n) => n._id)).toEqual(['empty']); // folder is never empty
    expect(c.blankTasks.map((t) => t._id)).toEqual(['blank']);
    expect(c.completedTasks.map((t) => t._id)).toEqual(['done']);
    expect(c.total).toBe(3);
  });

  it('excludes deleted items', () => {
    const c = cleanupCandidates([note({ _id: 'e', deleted: true })], [task({ _id: 'd', title: 'X', completed: true, deleted: 'true' })]);
    expect(c.total).toBe(0);
  });

  it('scopes completed tasks to a list when asked', () => {
    const tasks = [
      task({ _id: 'a', title: 'A', completed: true, parentNoteId: 'list1' }),
      task({ _id: 'b', title: 'B', completed: true, parentNoteId: 'list2' }),
    ];
    expect(cleanupCandidates([], tasks, 'list1').completedTasks.map((t) => t._id)).toEqual(['a']);
  });
});
