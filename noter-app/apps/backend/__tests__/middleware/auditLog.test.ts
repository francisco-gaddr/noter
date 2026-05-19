import { summariseBodyShape } from '../../src/middleware/auditLog';

describe('summariseBodyShape', () => {
  it('reports key→type shape for non-sensitive primitives', () => {
    expect(summariseBodyShape({ slug: 'abc', count: 3, ok: true })).toEqual({
      slug: 'string',
      count: 'number',
      ok: 'boolean',
    });
  });

  it('redacts sensitive top-level keys (password, token, email, etc.)', () => {
    const out = summariseBodyShape({ email: 'a@b.c', password: 'x', token: 'y' }) as Record<string, string>;
    expect(out.email).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
  });

  it('redacts encrypted columns by name (title, content, iv)', () => {
    const out = summariseBodyShape({ title: 'A', content: 'B', iv: 'C' }) as Record<string, string>;
    expect(out.title).toBe('[REDACTED]');
    expect(out.content).toBe('[REDACTED]');
    expect(out.iv).toBe('[REDACTED]');
  });

  it('summarises top-level arrays as [length, sample-type]', () => {
    expect(summariseBodyShape(['a', 'b', 'c'])).toEqual(['[3]', 'string']);
  });

  it('arrays within an object reach the same shape through recursion', () => {
    const out = summariseBodyShape({ tags: ['a', 'b'] }) as Record<string, unknown>;
    expect(Array.isArray(out.tags)).toBe(true);
    expect(out.tags).toEqual(['[2]', 'string']);
  });

  it('truncates beyond depth 3 with ellipsis', () => {
    // a (d0) → b (d1) → c (d2) → d (d3) → next level (d4) hits the truncation.
    const deep = { a: { b: { c: { d: { e: 'leak' } } } } };
    const out = summariseBodyShape(deep) as any;
    expect(out.a.b.c.d).toBe('…');
  });

  it('returns null/"undefined" markers for absent values', () => {
    expect(summariseBodyShape(null)).toBeNull();
    expect(summariseBodyShape(undefined)).toBe('undefined');
  });

  it('returns top-level type for primitive bodies', () => {
    expect(summariseBodyShape('hello')).toBe('string');
    expect(summariseBodyShape(42)).toBe('number');
    expect(summariseBodyShape(true)).toBe('boolean');
  });

  it('empty arrays represented as "[]"', () => {
    expect(summariseBodyShape([])).toBe('[]');
  });

  it('phone is redacted (PII)', () => {
    const out = summariseBodyShape({ phone: '+46...' }) as Record<string, string>;
    expect(out.phone).toBe('[REDACTED]');
  });
});
