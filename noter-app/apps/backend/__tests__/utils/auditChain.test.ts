import { canonicalJson, auditChainHash, verifyAuditChain, type ChainedEntry } from '../../src/utils/auditChain';

const KEY = 'operator-secret';
const sealedOf = (e: ChainedEntry) => ({ action: e.action, seq: e.seq });

/** Build a valid chain of N entries from the given actions. */
const buildChain = (actions: string[]): ChainedEntry[] => {
  const out: ChainedEntry[] = [];
  let prev = '';
  actions.forEach((action, i) => {
    const content = { action, seq: i + 1 };
    const hash = auditChainHash(KEY, prev, content);
    out.push({ ...content, prevHash: prev, hash });
    prev = hash;
  });
  return out;
};

describe('canonicalJson', () => {
  it('is key-order independent and ISO-serialises dates', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    const d = new Date('2026-06-19T00:00:00.000Z');
    expect(canonicalJson({ ts: d })).toContain('2026-06-19T00:00:00.000Z');
  });
});

describe('verifyAuditChain', () => {
  it('accepts an intact chain', () => {
    const chain = buildChain(['create', 'update', 'delete']);
    expect(verifyAuditChain(KEY, chain, sealedOf)).toEqual({ ok: true, brokenAt: -1 });
  });

  it('detects a MODIFIED entry (recomputed hash mismatches)', () => {
    const chain = buildChain(['create', 'update', 'delete']);
    (chain[1] as any).action = 'TAMPERED'; // change the recorded action without recomputing the hash
    const r = verifyAuditChain(KEY, chain, sealedOf);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
    expect(r.reason).toBe('modified');
  });

  it('detects a DELETED entry (next prevHash no longer links)', () => {
    const chain = buildChain(['create', 'update', 'delete']);
    const withGap = [chain[0], chain[2]]; // drop the middle entry
    const r = verifyAuditChain(KEY, withGap, sealedOf);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
    expect(r.reason).toBe('unlinked');
  });

  it('cannot be forged without the key', () => {
    const chain = buildChain(['create', 'update']);
    // An attacker rewrites entry 1 and recomputes the hash with the WRONG key.
    (chain[1] as any).action = 'forged';
    (chain[1] as any).hash = auditChainHash('attacker-guess', chain[1].prevHash!, sealedOf(chain[1]));
    expect(verifyAuditChain(KEY, chain, sealedOf).ok).toBe(false);
  });

  it('an empty chain is trivially intact', () => {
    expect(verifyAuditChain(KEY, [], sealedOf)).toEqual({ ok: true, brokenAt: -1 });
  });
});
