import { clearEncryptionKey, encrypt, setEncryptionKey } from '@repo/shared';
import { buildSecurityNoteMap, findBlockingLockedAncestor, isReadableWithLocks, maskLockedHierarchy } from '../services/ai/security';

describe('ai security lock hierarchy', () => {
  const notes = [
    { _id: 'p1', type: 'project', parentId: null, locked: true, title: 'Proj', content: '' },
    { _id: 'n1', type: 'note', parentId: 'p1', locked: false, title: 'Barn', content: 'Hemlig text' },
    { _id: 'n2', type: 'note', parentId: null, locked: false, title: 'Fri', content: 'Synlig' },
  ] as any[];

  beforeEach(() => {
    setEncryptionKey('a'.repeat(64));
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  it('masks descendants of locked project', () => {
    const secured = maskLockedHierarchy(notes);
    const project = secured.find((item) => item._id === 'p1');
    const child = secured.find((item) => item._id === 'n1');
    expect(project?.title).toBe('Proj');
    expect(child?.title).toBe('Låst anteckning');
    expect(child?.content).toBe('');
  });

  it('blocks ai access until ancestor is unlocked', () => {
    const map = buildSecurityNoteMap(notes as any);
    const child = map.get('n1');
    expect(isReadableWithLocks(child as any, map as any, new Set())).toBe(false);
    expect(findBlockingLockedAncestor(child as any, map as any, new Set())?._id).toBe('p1');
    expect(isReadableWithLocks(child as any, map as any, new Set(['p1']))).toBe(true);
  });

  it('blocks descendants when locked flag is encrypted', () => {
    const encryptedNotes = [
      { _id: 'p2', type: 'project', parentId: null, locked: encrypt('true'), title: 'Proj', content: '' },
      { _id: 'n3', type: 'note', parentId: 'p2', locked: encrypt('false'), title: 'Barn', content: 'Hemlig text' },
    ] as any[];
    const map = buildSecurityNoteMap(encryptedNotes as any);
    const child = map.get('n3');
    expect(findBlockingLockedAncestor(child as any, map as any, new Set())?._id).toBe('p2');
    expect(isReadableWithLocks(child as any, map as any, new Set())).toBe(false);
    expect(isReadableWithLocks(child as any, map as any, new Set(['p2']))).toBe(true);
  });
});
