import {
  noteContentIsEmpty,
  isBlankNote,
  isBlankTask,
  isProjectFolder,
  isPlainNote,
  visibleNotes,
  visibleTasks,
  completedTasks,
  isHiddenSyncedNote,
} from './displayFilters';

describe('displayFilters', () => {
  describe('noteContentIsEmpty', () => {
    it('treats blank/whitespace/HTML-empty/Slate-empty as empty', () => {
      expect(noteContentIsEmpty('')).toBe(true);
      expect(noteContentIsEmpty('   ')).toBe(true);
      expect(noteContentIsEmpty('<p></p>')).toBe(true);
      expect(noteContentIsEmpty('<p><br></p>')).toBe(true);
      expect(noteContentIsEmpty('&nbsp;')).toBe(true);
      expect(noteContentIsEmpty('[{"type":"paragraph","children":[{"text":""}]}]')).toBe(true);
      expect(noteContentIsEmpty(null)).toBe(true);
    });
    it('treats real text as non-empty', () => {
      expect(noteContentIsEmpty('hello')).toBe(false);
      expect(noteContentIsEmpty('<p>hello</p>')).toBe(false);
      expect(noteContentIsEmpty('[{"type":"paragraph","children":[{"text":"hi"}]}]')).toBe(false);
    });
  });

  it('isBlankNote: only truly-empty plain notes, never folders', () => {
    expect(isBlankNote({ title: '', content: '', type: 'note' })).toBe(true);
    expect(isBlankNote({ title: '  ', content: '<p></p>', type: 'note' })).toBe(true);
    expect(isBlankNote({ title: 'Named', content: '', type: 'note' })).toBe(false); // titled
    expect(isBlankNote({ title: '', content: 'text', type: 'note' })).toBe(false); // has content
    expect(isBlankNote({ title: '', content: '', type: 'project' })).toBe(false); // folder, not "blank"
  });

  it('classifies note types', () => {
    expect(isProjectFolder({ type: 'project' })).toBe(true);
    expect(isPlainNote({ type: 'note' })).toBe(true);
    expect(isPlainNote({ type: undefined })).toBe(true);
    expect(isPlainNote({ type: 'project' })).toBe(false);
  });

  it('isBlankTask: titleless tasks are blank', () => {
    expect(isBlankTask({ title: '' })).toBe(true);
    expect(isBlankTask({ title: '   ' })).toBe(true);
    expect(isBlankTask({ title: 'Do it' })).toBe(false);
  });

  it('visibleNotes: excludes projects, task-lists, blanks and deleted', () => {
    const notes = [
      { _id: '1', title: 'Real', content: 'x', type: 'note' as const },
      { _id: '2', title: '', content: '', type: 'note' as const }, // blank
      { _id: '3', title: 'Proj', content: '', type: 'project' as const }, // folder
      { _id: '4', title: 'List', content: '', type: 'task_list' as const }, // folder
      { _id: '5', title: 'Gone', content: 'x', type: 'note' as const, deleted: true },
      { _id: '6', title: 'Keep', content: 'y' }, // undefined type → plain
    ];
    expect(visibleNotes(notes as any).map((n: any) => n._id)).toEqual(['1', '6']);
  });

  it('isHiddenSyncedNote: hides binaries by source AND by title (source-independent)', () => {
    // by source (image)
    expect(isHiddenSyncedNote({ source: { origin: 'nextcloud', remotePath: 'x.png', mimeType: 'image/png' } } as any)).toBe(true);
    // editable text stays visible
    expect(isHiddenSyncedNote({ source: { origin: 'nextcloud', remotePath: 'x.md' } } as any)).toBe(false);
    // by TITLE even with NO source (source was lost)
    expect(isHiddenSyncedNote({ title: 'photo.png' } as any)).toBe(true);
    expect(isHiddenSyncedNote({ title: 'rapport.pdf' } as any)).toBe(true);
    expect(isHiddenSyncedNote({ title: 'ark.xlsx' } as any)).toBe(true);
    // a plain text note stays visible
    expect(isHiddenSyncedNote({ title: 'My note' } as any)).toBe(false);
    expect(isHiddenSyncedNote({ title: 'todo.md' } as any)).toBe(false);
  });

  it('visibleTasks + completedTasks', () => {
    const tasks = [
      { _id: '1', title: 'A', completed: false },
      { _id: '2', title: '', completed: false }, // blank
      { _id: '3', title: 'B', completed: true },
      { _id: '4', title: 'C', completed: true, deleted: true },
    ];
    expect(visibleTasks(tasks as any).map((t) => t._id)).toEqual(['1', '3']);
    expect(completedTasks(tasks as any).map((t) => t._id)).toEqual(['3']);
  });
});
