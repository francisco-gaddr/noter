import { normalizeNoteType, isProjectType } from './noteType';
import { encrypt, setActiveDataKey } from './encrypt';

describe('normalizeNoteType', () => {
  it('classifies plain values', () => {
    expect(normalizeNoteType('project')).toBe('project');
    expect(normalizeNoteType('note')).toBe('note');
    expect(normalizeNoteType('task_list')).toBe('task_list');
    expect(normalizeNoteType('task-list')).toBe('task_list');
    expect(normalizeNoteType('task list')).toBe('task_list');
    expect(normalizeNoteType('folder')).toBe('project');
  });

  it('tolerates quoting and casing', () => {
    expect(normalizeNoteType('"Project"')).toBe('project');
    expect(normalizeNoteType('`PROJECT`')).toBe('project');
  });

  it('defaults unknown/empty to note', () => {
    expect(normalizeNoteType(undefined)).toBe('note');
    expect(normalizeNoteType('')).toBe('note');
    expect(normalizeNoteType(42 as any)).toBe('note');
  });

  it('decrypts a still-encrypted type before classifying (the leak bug)', () => {
    // Encrypt the literal "project" with the current key, then classify the
    // ciphertext directly — it must still resolve to 'project', not 'note'.
    const ciphertext = encrypt('project');
    expect(ciphertext).not.toBe('project');
    expect(normalizeNoteType(ciphertext)).toBe('project');
    expect(isProjectType(ciphertext)).toBe(true);
  });
});
