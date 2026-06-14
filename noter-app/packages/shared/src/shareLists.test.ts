import { listShareableTaskLists } from './shareLists';
import { encrypt } from './encrypt';

const note = (over: any) => ({ _id: over._id, type: 'note', title: 'N', locked: false, ...over });

describe('listShareableTaskLists', () => {
  it('includes notes explicitly typed task_list', () => {
    const notes = [note({ _id: 'a', type: 'task_list', title: 'Handla' }), note({ _id: 'b', type: 'note' })];
    const out = listShareableTaskLists(notes, [], []);
    expect(out.map((l) => l.id)).toEqual(['a']);
    expect(out[0].name).toBe('Handla');
  });

  it('includes a note whose type arrived STILL-ENCRYPTED (the empty-picker bug)', () => {
    // This is the real-world shape: type stored as ciphertext. The old raw
    // `type === 'task_list'` check failed; the decrypt-aware classifier must pass.
    const notes = [note({ _id: 'enc', type: encrypt('task_list'), title: 'Krypterad lista' })];
    const out = listShareableTaskLists(notes, [], []);
    expect(out.map((l) => l.id)).toEqual(['enc']);
  });

  it('includes a note identified ONLY by having tasks (no task_list type)', () => {
    const notes = [note({ _id: 'p', type: 'project', title: 'Träning' }), note({ _id: 'n', type: 'note' })];
    const tasks = [{ parentNoteId: 'p' }];
    const out = listShareableTaskLists(notes, tasks, []);
    expect(out.map((l) => l.id)).toEqual(['p']);
  });

  it('excludes a locked-and-not-unlocked list (never shareable)', () => {
    const notes = [note({ _id: 'locked', type: 'task_list', title: 'Hemlig', locked: true })];
    expect(listShareableTaskLists(notes, [], []).length).toBe(0);
    // ...but visible once unlocked
    expect(listShareableTaskLists(notes, [], ['locked']).length).toBe(1);
  });

  it('does not duplicate a list that is both typed task_list AND has tasks', () => {
    const notes = [note({ _id: 'x', type: 'task_list', title: 'Dubbel' })];
    const tasks = [{ parentNoteId: 'x' }, { parentNoteId: 'x' }];
    const out = listShareableTaskLists(notes, tasks, []);
    expect(out.map((l) => l.id)).toEqual(['x']);
  });

  it('ignores tasks with no parent and notes with no id', () => {
    const notes = [note({ _id: '', type: 'task_list' }), note({ _id: 'ok', type: 'task_list', title: 'Ok' })];
    const tasks = [{ parentNoteId: undefined }];
    const out = listShareableTaskLists(notes, tasks, []);
    expect(out.map((l) => l.id)).toEqual(['ok']);
  });
});
