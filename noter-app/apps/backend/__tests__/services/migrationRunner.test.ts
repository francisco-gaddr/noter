import { _validateMigrations } from '../../src/services/migrationRunner';

describe('migrationRunner — validateMigrations', () => {
  it('accepts a list of valid migrations', () => {
    expect(() => _validateMigrations([
      { id: '2026-01-01-init', up: async () => undefined },
      { id: '2026-02-01-tags', up: async () => undefined },
    ])).not.toThrow();
  });

  it('rejects ids with whitespace or special chars', () => {
    expect(() => _validateMigrations([
      { id: 'has spaces', up: async () => undefined },
    ])).toThrow(/invalid/);
    expect(() => _validateMigrations([
      { id: '../traversal', up: async () => undefined },
    ])).toThrow(/invalid/);
  });

  it('rejects empty id', () => {
    expect(() => _validateMigrations([
      { id: '', up: async () => undefined },
    ])).toThrow(/invalid/);
  });

  it('rejects id longer than 128 chars', () => {
    expect(() => _validateMigrations([
      { id: 'a'.repeat(200), up: async () => undefined },
    ])).toThrow(/invalid/);
  });

  it('rejects duplicate ids', () => {
    expect(() => _validateMigrations([
      { id: 'dup', up: async () => undefined },
      { id: 'dup', up: async () => undefined },
    ])).toThrow(/duplicate/);
  });

  it('rejects missing up() function', () => {
    expect(() => _validateMigrations([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'no-up' } as any,
    ])).toThrow(/missing up/);
  });

  it('accepts ids with dots and underscores', () => {
    expect(() => _validateMigrations([
      { id: '2026.05.19_index-priority', up: async () => undefined },
    ])).not.toThrow();
  });
});
