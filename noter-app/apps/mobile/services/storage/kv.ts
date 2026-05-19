/**
 * Key-Value storage abstraction.
 *
 * Why: AsyncStorage works but is async-only, slow on cold-start (every read
 * goes through the bridge), and stalls our hydration. MMKV (Tencent's library
 * ported to React Native) is synchronous, ~30× faster, and battery-friendly.
 *
 * We don't ship MMKV as a dep yet because adopting it requires a native
 * rebuild + EAS dev-client refresh. This abstraction lets us migrate when
 * we're ready — the only change is `useMmkvWhenAvailable: true` below.
 *
 * Migration runs once on app boot. AsyncStorage stays as the source of truth
 * until every callsite uses `kv` and we've shipped one build of the app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface KVStore {
  getString: (key: string) => Promise<string | null>;
  setString: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
  getAllKeys: () => Promise<string[]>;
  /** Optional: synchronous read path. Adapters that don't support it return null. */
  getStringSync: (key: string) => string | null;
}

const buildAsyncStorageAdapter = (): KVStore => ({
  getString: async (key) => AsyncStorage.getItem(key),
  setString: async (key, value) => AsyncStorage.setItem(key, value),
  delete: async (key) => AsyncStorage.removeItem(key),
  getAllKeys: async () => (await AsyncStorage.getAllKeys()).slice(),
  getStringSync: () => null, // AsyncStorage has no synchronous read
});

/**
 * MMKV adapter — wired only when `react-native-mmkv` is installed.
 *
 * We require() it lazily so missing-dep imports don't crash hydration. The
 * dynamic require pattern is necessary: a top-level `import` would fail at
 * bundler-time before we even reach the feature-flag check.
 */
const buildMmkvAdapter = (): KVStore | null => {
  let mmkv: { getString: (k: string) => string | undefined; set: (k: string, v: string) => void; delete: (k: string) => void; getAllKeys: () => string[] } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MMKV } = require('react-native-mmkv') as { MMKV: new (config?: { id?: string }) => typeof mmkv };
    mmkv = new (MMKV as unknown as { new (cfg?: { id?: string }): typeof mmkv })({ id: 'noter.kv' });
  } catch {
    return null;
  }
  if (!mmkv) return null;
  const live = mmkv;
  return {
    getString: async (key) => {
      const v = live.getString(key);
      return typeof v === 'string' ? v : null;
    },
    setString: async (key, value) => {
      live.set(key, value);
    },
    delete: async (key) => {
      live.delete(key);
    },
    getAllKeys: async () => live.getAllKeys(),
    getStringSync: (key) => {
      const v = live.getString(key);
      return typeof v === 'string' ? v : null;
    },
  };
};

const USE_MMKV_WHEN_AVAILABLE = false; // Flip to true once MMKV is installed & migration verified

let resolved: KVStore | null = null;
let backend: 'mmkv' | 'async-storage' = 'async-storage';

const resolve = (): KVStore => {
  if (resolved) return resolved;
  if (USE_MMKV_WHEN_AVAILABLE) {
    const mmkv = buildMmkvAdapter();
    if (mmkv) {
      resolved = mmkv;
      backend = 'mmkv';
      return resolved;
    }
  }
  resolved = buildAsyncStorageAdapter();
  backend = 'async-storage';
  return resolved;
};

export const kv: KVStore = {
  getString: (key) => resolve().getString(key),
  setString: (key, value) => resolve().setString(key, value),
  delete: (key) => resolve().delete(key),
  getAllKeys: () => resolve().getAllKeys(),
  getStringSync: (key) => resolve().getStringSync(key),
};

export const kvBackend = (): 'mmkv' | 'async-storage' => {
  resolve();
  return backend;
};

/**
 * One-shot migration from AsyncStorage → MMKV.
 *
 * Idempotent: writes a sentinel after success so repeated boots no-op. Runs
 * during app startup; callers should invoke it AFTER React is mounted but
 * BEFORE any feature reads from kv, since the cutover is non-atomic per key.
 *
 * Currently a no-op because MMKV isn't installed. Once it is, the migration
 * runs as soon as `USE_MMKV_WHEN_AVAILABLE` flips to true.
 */
const MIGRATION_SENTINEL_KEY = '__noter_kv_migration_v1__';

export const runKvMigrationIfNeeded = async (): Promise<{ migrated: number; skipped: boolean }> => {
  // If we're not using MMKV, no migration is needed — AsyncStorage IS the store.
  if (kvBackend() !== 'mmkv') return { migrated: 0, skipped: true };
  const mmkv = resolved as KVStore;
  const sentinel = await mmkv.getString(MIGRATION_SENTINEL_KEY);
  if (sentinel === '1') return { migrated: 0, skipped: true };

  const keys = await AsyncStorage.getAllKeys();
  let migrated = 0;
  // Read in batches to avoid blocking the JS thread on cold-start with hundreds
  // of keys. Each batch yields to the event loop so we don't stall paint.
  const BATCH_SIZE = 32;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const pairs = await AsyncStorage.multiGet(batch);
    for (const [k, v] of pairs) {
      if (typeof v === 'string') {
        await mmkv.setString(k, v);
        migrated++;
      }
    }
    await new Promise((r) => setTimeout(r, 0)); // yield
  }
  await mmkv.setString(MIGRATION_SENTINEL_KEY, '1');
  return { migrated, skipped: false };
};
