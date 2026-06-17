/**
 * REAL-SQLite integration test for the recurring "AI chat history is empty" bug.
 *
 * Root cause: the `messages` table has `FOREIGN KEY(conversationId) REFERENCES
 * conversations(id) ON DELETE CASCADE` with `PRAGMA foreign_keys = ON`. The old
 * `saveConversationLocal` used `INSERT OR REPLACE INTO conversations`, which on a
 * primary-key conflict DELETES the existing conversation row (firing the cascade →
 * wiping every message) and re-inserts it. Because `saveConversationLocal` runs on
 * every sync pull / auto-title / rename / socket update, re-saving a conversation
 * silently erased its history.
 *
 * This test mocks `expo-sqlite` with a faithful adapter over Node's built-in
 * `node:sqlite` (same SQL, real FK + cascade semantics) and exercises the ACTUAL
 * `services/database.ts` code, so it fails on the old INSERT-OR-REPLACE and passes
 * only with the ON CONFLICT DO UPDATE upsert.
 */

// node:sqlite is built into Node 22.5+/24+ (the CI + local validate gate run ≥22). If the
// runtime lacks it, skip rather than error — the gate environments always have it.
const HAS_SQLITE = (() => { try { require('node:sqlite'); return true; } catch { return false; } })();
const d = HAS_SQLITE ? describe : describe.skip;
if (!HAS_SQLITE) console.warn('[cascade-test] node:sqlite unavailable on this runtime — skipping (needs Node ≥22).');

// Adapter: expo-sqlite's async surface backed by a real in-memory SQLite engine. Lazy so the
// module import never throws when node:sqlite is absent (the real DatabaseSync is only built
// on first DB use, which a skipped suite never reaches).
jest.mock('expo-sqlite', () => {
  const clean = (params: any[] = []) => params.map((p) => (p === undefined ? null : p));
  const make = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(':memory:');
    const api: any = {
      execAsync: async (sql: string) => { d.exec(sql); },
      runAsync: async (sql: string, params: any[] = []) => {
        const r = d.prepare(sql).run(...clean(params));
        return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
      },
      getAllAsync: async (sql: string, params: any[] = []) => d.prepare(sql).all(...clean(params)),
      getFirstAsync: async (sql: string, params: any[] = []) => d.prepare(sql).get(...clean(params)) ?? null,
      withExclusiveTransactionAsync: async (body: (txn: any) => Promise<void>) => {
        d.exec('BEGIN'); try { await body(api); d.exec('COMMIT'); } catch (e) { try { d.exec('ROLLBACK'); } catch { /* */ } throw e; }
      },
      withTransactionAsync: async (body: () => Promise<void>) => {
        d.exec('BEGIN'); try { await body(); d.exec('COMMIT'); } catch (e) { try { d.exec('ROLLBACK'); } catch { /* */ } throw e; }
      },
    };
    return api;
  };
  // Lazy handle: the real engine (and the node:sqlite require) is built only on first DB use,
  // so importing services/database.ts never throws on a runtime without node:sqlite.
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

import {
  initDatabase,
  saveConversationLocal,
  saveMessageLocal,
  getMessagesLocal,
  getConversationsLocal,
  deleteConversationLocal,
} from '../services/database';
import type { Conversation, Message } from '@repo/shared';

const conv = (id: string, title: string): Conversation & { localOnly?: boolean } => ({
  id, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], localOnly: false,
} as any);

const msg = (id: string, role: string, content: string): Message => ({
  id, role: role as any, content, createdAt: new Date().toISOString(),
} as any);

d('conversation re-save must NOT wipe its messages (FK cascade bug)', () => {
  beforeAll(async () => { await initDatabase(); });

  it('keeps all messages when the conversation is re-saved (sync/rename/socket)', async () => {
    const c = conv('c-1', 'Min tråd');
    await saveConversationLocal(c);
    await saveMessageLocal('c-1', msg('m1', 'user', 'Hej AI'));
    await saveMessageLocal('c-1', msg('m2', 'assistant', 'Hej! Hur kan jag hjälpa?'));
    await saveMessageLocal('c-1', msg('m3', 'user', 'Skriv en dikt'));
    expect((await getMessagesLocal('c-1')).length).toBe(3);

    // Re-save the SAME conversation (this is what mergeRemoteSync / auto-title / rename do).
    await saveConversationLocal({ ...c, title: 'Min tråd (omdöpt)', updatedAt: new Date().toISOString() });

    // The history MUST survive the re-save.
    const after = await getMessagesLocal('c-1');
    expect(after.length).toBe(3);
    expect(after.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    // And the conversation itself updated in place.
    const convs = await getConversationsLocal();
    expect(convs.find((x) => x.id === 'c-1')?.title).toBe('Min tråd (omdöpt)');
  });

  it('survives many repeated re-saves (e.g. a chatty sync loop)', async () => {
    await saveConversationLocal(conv('c-2', 'Loop'));
    await saveMessageLocal('c-2', msg('a', 'user', 'x'));
    await saveMessageLocal('c-2', msg('b', 'assistant', 'y'));
    for (let i = 0; i < 25; i += 1) {
      await saveConversationLocal({ ...conv('c-2', `Loop ${i}`), updatedAt: new Date(Date.now() + i).toISOString() });
    }
    expect((await getMessagesLocal('c-2')).length).toBe(2);
  });

  it('content round-trips through encrypt/decrypt after a re-save', async () => {
    await saveConversationLocal(conv('c-3', 't'));
    await saveMessageLocal('c-3', msg('only', 'assistant', 'Detta måste överleva omsparningen.'));
    await saveConversationLocal({ ...conv('c-3', 't2'), updatedAt: new Date().toISOString() });
    const after = await getMessagesLocal('c-3');
    expect(after).toHaveLength(1);
    expect(after[0].content).toBe('Detta måste överleva omsparningen.');
  });

  it('mergeRemoteSync sequence: re-saving a synced conversation keeps a LOCAL-ONLY message', async () => {
    // The real-world data-loss flow: you write a message, then a sync pull arrives. The old
    // mergeRemoteSync did `saveConversationLocal(remoteConv)` (re-save → cascade wipe) and then
    // saved only the REMOTE messages — so a message not yet on the server vanished.
    await saveConversationLocal(conv('s-1', 'Synkad tråd'));
    await saveMessageLocal('s-1', msg('server-1', 'user', 'Synkad fråga'));
    await saveMessageLocal('s-1', msg('local-unpushed', 'assistant', 'Svar skrivet offline, ej pushat än'));

    // Sync pull: mergeRemoteSync re-saves the conversation, then re-saves the server's copy of
    // the messages it HAS (server-1) — but NOT the local-only one.
    await saveConversationLocal({ ...conv('s-1', 'Synkad tråd'), updatedAt: new Date(Date.now() + 1).toISOString() });
    await saveMessageLocal('s-1', msg('server-1', 'user', 'Synkad fråga'));

    const after = await getMessagesLocal('s-1');
    const ids = after.map((m) => m.id);
    expect(ids).toContain('local-unpushed'); // must survive the sync
    expect(ids).toContain('server-1');
    expect(after).toHaveLength(2);
  });

  it('explicit conversation DELETE still cascades (intended) — messages gone', async () => {
    await saveConversationLocal(conv('c-4', 'tmp'));
    await saveMessageLocal('c-4', msg('d1', 'user', 'temp'));
    expect((await getMessagesLocal('c-4')).length).toBe(1);
    await deleteConversationLocal('c-4');
    expect((await getMessagesLocal('c-4')).length).toBe(0);
  });
});
