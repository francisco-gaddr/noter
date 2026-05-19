import { summariseFilter } from '../../src/utils/slowQueryLogger';

describe('summariseFilter (PII redaction in slow-query log)', () => {
  it('redacts sensitive keys at top level', () => {
    const out = summariseFilter({ email: 'a@b.c', token: 'xyz', id: '1' });
    expect((out as any).email).toBe('[REDACTED]');
    expect((out as any).token).toBe('[REDACTED]');
    expect((out as any).id).toBe('1');
  });

  it('redacts sensitive keys at nested levels', () => {
    const out = summariseFilter({ user: { email: 'leak@example.com', name: 'Alice' } });
    expect((out as any).user.email).toBe('[REDACTED]');
    expect((out as any).user.name).toBe('Alice');
  });

  it('truncates long string values', () => {
    const out = summariseFilter({ note: 'x'.repeat(100) });
    const v = (out as any).note;
    expect(v.length).toBeLessThan(50);
    expect(v).toContain('…');
  });

  it('summarises arrays as [count]', () => {
    const out = summariseFilter({ ids: [1, 2, 3, 4, 5] });
    expect((out as any).ids).toBe('[5]');
  });

  it('truncates at depth 2', () => {
    const out = summariseFilter({ a: { b: { c: { d: 'deep' } } } });
    expect((out as any).a.b.c).toBe('…');
  });

  it('passes through primitives unchanged', () => {
    expect(summariseFilter(42)).toBe(42);
    expect(summariseFilter(true)).toBe(true);
    expect(summariseFilter(null)).toBeNull();
  });
});
