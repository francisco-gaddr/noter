/**
 * A tiny bounded LRU cache (least-recently-used eviction). Generic + dependency-free so it's shared
 * by web + mobile. Backed by a Map (which preserves insertion order): reading bumps a key to
 * most-recent; writing past `max` evicts the oldest. Use it to memoise pure/deterministic results
 * — e.g. query embeddings (same model+text → same vector), so a repeated search doesn't re-pay the
 * embedding call's latency + cost (a standard RAG optimisation).
 */
export interface LruCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  has(key: string): boolean;
  /** Current entry count (diagnostics / tests). */
  size(): number;
  clear(): void;
}

export const createLruCache = <V>(max = 64): LruCache<V> => {
  const cap = Math.max(1, Math.floor(max));
  const store = new Map<string, V>();
  return {
    get(key) {
      const v = store.get(key);
      if (v !== undefined && store.delete(key)) store.set(key, v); // bump recency
      return v;
    },
    set(key, value) {
      if (store.has(key)) store.delete(key);
      store.set(key, value);
      while (store.size > cap) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
    has: (key) => store.has(key),
    size: () => store.size,
    clear: () => store.clear(),
  };
};
