import Task from '../../src/models/Task';

// Regression guard: the task list always sorts by createdAt desc (and the cursor page adds a createdAt
// range + _id tiebreak). The {userId, createdAt, _id} index is what keeps that off an in-memory sort
// (capped at 32MB). If someone removes it, the list silently degrades at scale — fail loudly instead.
describe('Task schema indexes', () => {
  const indexes = Task.schema.indexes().map(([fields]) => JSON.stringify(fields));

  it('has the {userId, createdAt:-1, _id:-1} sort index', () => {
    expect(indexes).toContain(JSON.stringify({ userId: 1, createdAt: -1, _id: -1 }));
  });

  it('still has the userId-scoped lookup indexes (IDOR-safe queries)', () => {
    expect(indexes).toContain(JSON.stringify({ userId: 1, parentNoteId: 1 }));
    expect(indexes).toContain(JSON.stringify({ userId: 1, completed: 1 }));
  });
});
