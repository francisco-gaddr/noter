import { agentSearchNotes } from './agentSearch';
import type { Note, Task } from './types';

const note = (id: string, title: string, content = '', extra: Partial<Note> = {}): Note =>
  ({ _id: id, title, content, type: 'note', ...extra } as Note);
const task = (id: string, title: string, parentNoteId?: string): Task =>
  ({ _id: id, title, parentNoteId } as unknown as Task);

describe('agentSearchNotes', () => {
  it('returns lexical hits ranked best-first with id/kind/title/snippet', () => {
    const notes = [
      note('a', 'Project Alpha', 'the alpha launch plan'),
      note('b', 'Beta notes', 'unrelated content about gardening'),
    ];
    const hits = agentSearchNotes(notes, [], 'alpha launch');
    expect(hits[0].id).toBe('a');
    expect(hits[0]).toMatchObject({ kind: 'note', title: 'Project Alpha' });
    expect(hits.find((h) => h.id === 'b')).toBeUndefined(); // no term overlap → not returned
  });

  it('SECURITY: never returns a locked note, even one matching the query', () => {
    const notes = [
      note('open', 'Roadmap secret strategy', 'public roadmap'),
      note('locked', 'Secret strategy', 'top secret strategy', { locked: 'true' } as any),
    ];
    const hits = agentSearchNotes(notes, [], 'secret strategy');
    expect(hits.map((h) => h.id)).toContain('open');
    expect(hits.map((h) => h.id)).not.toContain('locked'); // locked note is invisible to the agent
  });

  it('SECURITY: excludes a note under a locked project folder', () => {
    const notes = [
      note('folder', 'Vault', '', { type: 'project', locked: 'true' } as any),
      note('child', 'secret child note', 'secret content', { parentId: 'folder' } as any),
      note('free', 'secret free note', 'secret content'),
    ];
    const hits = agentSearchNotes(notes, [], 'secret');
    expect(hits.map((h) => h.id)).toEqual(['free']); // the child under the locked folder is hidden
  });

  it('searches tasks too (excluding tasks under a locked list)', () => {
    const notes = [note('list', 'Locked list', '', { type: 'task_list', locked: 'true' } as any)];
    const tasks = [task('t1', 'buy milk'), task('t2', 'secret task', 'list')];
    const hits = agentSearchNotes(notes, tasks, 'milk');
    expect(hits.map((h) => h.id)).toContain('t1');
    const secret = agentSearchNotes(notes, tasks, 'secret');
    expect(secret.map((h) => h.id)).not.toContain('t2'); // task under a locked list is hidden
  });

  it('returns [] for an empty/whitespace query and respects the limit', () => {
    const notes = Array.from({ length: 20 }, (_, i) => note(`n${i}`, `match item ${i}`, 'match body'));
    expect(agentSearchNotes(notes, [], '   ')).toEqual([]);
    expect(agentSearchNotes(notes, [], 'match', 5)).toHaveLength(5);
  });
});
