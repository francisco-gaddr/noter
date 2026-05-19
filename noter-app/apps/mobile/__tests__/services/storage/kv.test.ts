// Use the official AsyncStorage jest mock that ships with the library.
// It's already auto-mocked globally by jest.setup.js, so we just import it
// here to interact with the in-memory store directly when needed.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { kv, kvBackend, runKvMigrationIfNeeded } from '../../../services/storage/kv';

describe('kv abstraction (AsyncStorage adapter — default today)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('reports backend as async-storage when MMKV is not installed', () => {
    expect(kvBackend()).toBe('async-storage');
  });

  it('writes through to AsyncStorage', async () => {
    await kv.setString('alpha', 'A');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('alpha', 'A');
    expect(await AsyncStorage.getItem('alpha')).toBe('A');
  });

  it('reads through AsyncStorage', async () => {
    await AsyncStorage.setItem('beta', 'B');
    expect(await kv.getString('beta')).toBe('B');
  });

  it('returns null for unknown keys', async () => {
    expect(await kv.getString('does-not-exist')).toBeNull();
  });

  it('delete removes the key', async () => {
    await kv.setString('to-delete', 'x');
    await kv.delete('to-delete');
    expect(await AsyncStorage.getItem('to-delete')).toBeNull();
  });

  it('getAllKeys lists all stored keys', async () => {
    await kv.setString('a', '1');
    await kv.setString('b', '2');
    const keys = await kv.getAllKeys();
    expect(keys.sort()).toEqual(['a', 'b']);
  });

  it('getStringSync returns null on AsyncStorage adapter (no sync read)', () => {
    expect(kv.getStringSync('any-key')).toBeNull();
  });
});

describe('runKvMigrationIfNeeded', () => {
  it('reports skipped:true when AsyncStorage is the active backend (no migration needed)', async () => {
    const result = await runKvMigrationIfNeeded();
    expect(result.skipped).toBe(true);
    expect(result.migrated).toBe(0);
  });
});
