import { isAllowedStatement } from '../src/config/neo4j';
import { buildNeo4jSyncPlan, defaultNeo4jConfig } from '@repo/shared';
import type { Note } from '@repo/shared';

const note = (id: string, type: Note['type'], parentId?: string): Note => ({
  _id: id, userId: 'u', title: id, content: 'c-' + id, tags: [], locked: false,
  parentId: parentId ?? null, type, createdAt: '', updatedAt: '',
});

describe('Neo4j relay allowlist', () => {
  it('accepts EVERY statement the shared neo4jSync module emits', () => {
    const notes = [note('proj', 'project'), note('child', 'note', 'proj'), note('deep', 'note', 'child')];
    const cfg = { ...defaultNeo4jConfig(), enabled: true, projectFolderIds: ['proj'], includeBody: true };
    const plan = buildNeo4jSyncPlan('u', notes, [], cfg);
    expect(plan.length).toBeGreaterThan(1);
    for (const stmt of plan) {
      expect(isAllowedStatement(stmt.text)).toBe(true);
    }
  });

  it('rejects arbitrary / injected Cypher', () => {
    expect(isAllowedStatement('MATCH (n) DETACH DELETE n')).toBe(false);
    expect(isAllowedStatement('CALL dbms.procedures()')).toBe(false);
    // A trailing clause riding after the allowed prefix must NOT pass (anchored regex).
    expect(isAllowedStatement('MERGE (n:NoterNode {uid:$uid}) SET n.kind=$kind, n.title=$title, n.userId=$userId WITH n MATCH (m) DETACH DELETE m')).toBe(false);
    expect(isAllowedStatement('MERGE (x:Other {uid:$uid}) SET x.k=$kind')).toBe(false);
    expect(isAllowedStatement('')).toBe(false);
  });
});
