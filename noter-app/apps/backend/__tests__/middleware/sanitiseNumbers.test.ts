import { sanitiseValue } from '../../src/middleware/sanitiseNumbers';

describe('sanitiseValue', () => {
  it('passes through finite values unchanged', () => {
    const r = sanitiseValue({ a: 1, b: 2.5, c: -3 });
    expect(r.value).toEqual({ a: 1, b: 2.5, c: -3 });
    expect(r.paths).toEqual([]);
  });

  it('replaces NaN with null and records path', () => {
    const r = sanitiseValue({ x: NaN });
    expect(r.value).toEqual({ x: null });
    expect(r.paths).toEqual(['x']);
  });

  it('replaces Infinity / -Infinity', () => {
    const r = sanitiseValue({ a: Infinity, b: -Infinity });
    expect(r.value).toEqual({ a: null, b: null });
    expect(r.paths.sort()).toEqual(['a', 'b']);
  });

  it('walks arrays', () => {
    const r = sanitiseValue([1, NaN, 3]);
    expect(r.value).toEqual([1, null, 3]);
    expect(r.paths).toEqual(['[1]']);
  });

  it('walks nested objects', () => {
    const r = sanitiseValue({ outer: { inner: NaN } });
    expect(r.value).toEqual({ outer: { inner: null } });
    expect(r.paths).toEqual(['outer.inner']);
  });

  it('handles deeply mixed arrays and objects', () => {
    const r = sanitiseValue({ list: [{ x: NaN }, { y: 2 }] });
    expect(r.paths).toEqual(['list[0].x']);
  });

  it('preserves strings / booleans / null / Date instances', () => {
    const d = new Date('2026-05-19');
    const r = sanitiseValue({ s: 'hello', b: true, n: null, d });
    expect((r.value as Record<string, unknown>).d).toBe(d);
    expect(r.paths).toEqual([]);
  });

  it('truncates at depth limit', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 10; i++) {
      cur.next = { val: NaN };
      cur = cur.next as Record<string, unknown>;
    }
    const r = sanitiseValue(deep);
    // Paths beyond MAX_DEPTH (6) are not reported.
    expect(r.paths.length).toBeLessThanOrEqual(7);
  });

  it('top-level NaN', () => {
    const r = sanitiseValue(NaN);
    expect(r.value).toBeNull();
    expect(r.paths).toEqual(['<root>']);
  });

  it('top-level finite number', () => {
    const r = sanitiseValue(42);
    expect(r.value).toBe(42);
    expect(r.paths).toEqual([]);
  });
});
