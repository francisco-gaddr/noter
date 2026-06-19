/**
 * REAL-SQLite integration test for the ADR-0012 offline-persistence gap.
 *
 * Root cause: the local `notes` table never had a `folderKeyBundle` column, and
 * `saveNoteLocal` never persisted it. So a per-folder-encrypted ("crypto") folder loaded
 * from the local DB on an offline launch had no wrapped folder key → folderCryptoStatus()
 * returns 'plain' → the folder can never be unlocked offline and its v3f: notes stay
 * permanently masked until a server re-sync. (Same class as the Note.source local-persist gap.)
 *
 * This mocks `expo-sqlite` with a faithful adapter over Node's built-in `node:sqlite` (the same
 * setup the conversation-cascade test uses) and exercises the ACTUAL services/database.ts code,
 * so it fails without the migration + save/load wiring and passes only with the bundle persisted.
 */

// node:sqlite is built into Node 22.5+/24+ (the CI + local validate gate run ≥22). If the
// runtime lacks it, skip rather than error — the gate environments always have it.
const HAS_SQLITE = (() => { try { require('node:sqlite'); return true; } catch { return false; } })();
const d = HAS_SQLITE ? describe : describe.skip;
if (!HAS_SQLITE) console.warn('[folderkey-roundtrip-test] node:sqlite unavailable on this runtime — skipping (needs Node ≥22).');

jest.mock('expo-sqlite', () => {
  const clean = (params: any[] = []) => params.map((p) => (p === undefined ? null : p));
  const make = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const api: any = {
      execAsync: async (sql: string) => { db.exec(sql); },
      runAsync: async (sql: string, params: any[] = []) => {
        const r = db.prepare(sql).run(...clean(params));
        return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
      },
      getAllAsync: async (sql: string, params: any[] = []) => db.prepare(sql).all(...clean(params)),
      getFirstAsync: async (sql: string, params: any[] = []) => db.prepare(sql).get(...clean(params)) ?? null,
      withExclusiveTransactionAsync: async (body: (txn: any) => Promise<void>) => {
        db.exec('BEGIN'); try { await body(api); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; }
      },
      withTransactionAsync: async (body: () => Promise<void>) => {
        db.exec('BEGIN'); try { await body(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; }
      },
    };
    return api;
  };
  return {
    openDatabaseSync: () => {
      let real: any = null;
      const ensure = () => (real ?? (real = make()));
      const m = (name: string) => (...args: any[]) => ensure()[name](...args);
      return {
        execAsync: m('execAsync'),
        runAsync: m('runAsync'),
        getAllAsync: m('getAllAsync'),
        getFirstAsync: m('getFirstAsync'),
        withExclusiveTransactionAsync: m('withExclusiveTransactionAsync'),
        withTransactionAsync: m('withTransactionAsync'),
      };
    },
  };
});

import { initDatabase, saveNoteLocal, getNotesLocal } from '../services/database';

const baseNote = (over: Record<string, any>): any => ({
  _id: 'n', title: 'T', content: 'C', tags: [], type: 'note', userId: 'u1',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});

d('ADR-0012 local-DB folderKeyBundle persistence', () => {
  beforeAll(async () => { await initDatabase(); });

  it('round-trips a crypto folder\'s wrapped folderKeyBundle through save → load', async () => {
    // A realistic serialized FolderKeyBundle (the wrapped key + salt + kdf params; no secret
    // without the folder password). It MUST survive an offline reload so the folder stays unlockable.
    const bundle = JSON.stringify({ v: 1, kdf: 'argon2id', salt: 'c2FsdHk', wrappedKey: 'v3:d3JhcHBlZA', alg: 'AES-256-GCM' });
    await saveNoteLocal(baseNote({ _id: 'cryptoProj', title: 'Hemlig mapp', type: 'project', locked: true, folderKeyBundle: bundle }), true);

    const loaded = (await getNotesLocal()).find((n) => n._id === 'cryptoProj');
    expect(loaded).toBeDefined();
    // The bundle survives the round-trip in its plain serialized form (so readFolderKeyBundleFromNote can parse it).
    expect(loaded!.folderKeyBundle).toBe(bundle);
  });

  it('survives a re-save (sync/rename) without dropping or double-encrypting the bundle', async () => {
    const bundle = JSON.stringify({ v: 1, kdf: 'pbkdf2-sha256', salt: 'czI', wrappedKey: 'v3:dzI', alg: 'AES-256-GCM' });
    await saveNoteLocal(baseNote({ _id: 'cryptoProj2', title: 'Mapp', type: 'project', locked: true, folderKeyBundle: bundle }), true);
    // Re-load, then re-save the loaded note (what a sync pull / rename does), then load again.
    const first = (await getNotesLocal()).find((n) => n._id === 'cryptoProj2');
    await saveNoteLocal(first as any, true);
    const second = (await getNotesLocal()).find((n) => n._id === 'cryptoProj2');
    expect(second!.folderKeyBundle).toBe(bundle); // still the plain bundle, not a doubly-encrypted blob
  });

  it('loads folderKeyBundle as undefined for a normal (non-crypto) note', async () => {
    await saveNoteLocal(baseNote({ _id: 'plainNote', title: 'X', content: 'Y' }), true);
    const loaded = (await getNotesLocal()).find((n) => n._id === 'plainNote');
    expect(loaded).toBeDefined();
    expect(loaded!.folderKeyBundle).toBeUndefined();
  });
});
