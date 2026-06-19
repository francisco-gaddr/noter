import { createLruCache } from './lruCache';

describe('createLruCache', () => {
  it('stores and retrieves values', () => {
    const c = createLruCache<number>(3);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    expect(c.has('a')).toBe(true);
    expect(c.get('missing')).toBeUndefined();
    expect(c.size()).toBe(1);
  });

  it('evicts the least-recently-used entry past capacity', () => {
    const c = createLruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // 'a' is now most-recent → 'b' is the LRU
    c.set('c', 3); // evicts 'b'
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
    expect(c.size()).toBe(2);
  });

  it('updating an existing key refreshes recency without growing size', () => {
    const c = createLruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 10); // a is refreshed (most-recent), value updated
    c.set('c', 3); // evicts 'b' (the LRU), not 'a'
    expect(c.get('a')).toBe(10);
    expect(c.has('b')).toBe(false);
    expect(c.size()).toBe(2);
  });

  it('clear() empties it', () => {
    const c = createLruCache<number>(4);
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.get('a')).toBeUndefined();
  });
});
