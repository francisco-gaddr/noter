/**
 * CRDT "Live" core for External Markdown Sync — Phase 2.
 *
 * A note's plaintext content is held in a Yjs document (a single `Y.Text` named
 * "content"). Yjs gives conflict-free, keystroke-level, multi-writer convergence with
 * offline-merge — the 2026 state of the art for real-time Markdown. This module is the
 * pure, network-agnostic core (Y.Doc lifecycle + a prefix/suffix diff that turns a plain
 * string update into a minimal CRDT splice so concurrent edits elsewhere survive).
 *
 * Transport is layered on top (we relay Yjs binary updates over the app's existing,
 * JWT-authed socket.io rooms — see backend markdownLive relay + the client connectors).
 * The CRDT doc only ever holds the SHARED note's plaintext (opt-in, like the WebDAV
 * projection); E2E is preserved because the owner's client is what re-encrypts it.
 */
import * as Y from 'yjs';

export const LIVE_TEXT_KEY = 'content';

/** Create a Y.Doc seeded with the note's current content. */
export const createLiveDoc = (initialContent = ''): Y.Doc => {
  const doc = new Y.Doc();
  const text = doc.getText(LIVE_TEXT_KEY);
  if (initialContent) text.insert(0, initialContent);
  return doc;
};

/** Current content string of a live doc. */
export const getLiveContent = (doc: Y.Doc): string => doc.getText(LIVE_TEXT_KEY).toString();

/**
 * Reconcile the doc's Y.Text toward `next` with a MINIMAL splice (common prefix +
 * common suffix preserved). This keeps concurrent edits outside the changed region intact
 * — a naive delete-all/insert would clobber a remote peer's simultaneous edit. Returns
 * true if anything changed. Wrap callers in `doc.transact` for a single update.
 */
export const reconcileLiveContent = (doc: Y.Doc, next: string): boolean => {
  const text = doc.getText(LIVE_TEXT_KEY);
  const cur = text.toString();
  if (cur === next) return false;

  let start = 0;
  const maxStart = Math.min(cur.length, next.length);
  while (start < maxStart && cur[start] === next[start]) start++;

  let endCur = cur.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) { endCur--; endNext--; }

  doc.transact(() => {
    const delLen = endCur - start;
    if (delLen > 0) text.delete(start, delLen);
    const ins = next.slice(start, endNext);
    if (ins) text.insert(start, ins);
  }, 'local');
  return true;
};

/** Encode the full doc state as a binary update (for initial sync / persistence). */
export const encodeLiveState = (doc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(doc);

/** Apply a binary update to a doc. `origin` tags the source ('remote' by default) so a
 *  connector can avoid relaying updates it just received. Safe + idempotent (Yjs merges). */
export const applyLiveUpdate = (doc: Y.Doc, update: Uint8Array, origin: unknown = 'remote'): void => Y.applyUpdate(doc, update, origin);

/** Relay hook: fire for every doc update with the LOCAL-origin flag (skip remote echoes). */
export const onLiveUpdate = (doc: Y.Doc, cb: (update: Uint8Array, isLocal: boolean) => void): (() => void) => {
  const handler = (update: Uint8Array, origin: unknown) => cb(update, origin !== 'remote');
  doc.on('update', handler);
  return () => doc.off('update', handler);
};

/** Observe content changes WITH the remote flag (apply to the store only on remote). */
export const observeLiveContent = (doc: Y.Doc, cb: (content: string, isRemote: boolean) => void): (() => void) => {
  const text = doc.getText(LIVE_TEXT_KEY);
  const handler = (event: Y.YTextEvent) => cb(text.toString(), event.transaction.origin === 'remote');
  text.observe(handler);
  return () => text.unobserve(handler);
};

/** Base64 helpers for relaying binary updates over JSON sockets (RN/web/Node safe). */
export const toBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return typeof btoa !== 'undefined' ? btoa(bin) : bin;
};
export const fromBase64 = (b64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  // eslint-disable-next-line no-undef
  const bin = typeof atob !== 'undefined' ? atob(b64) : b64;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Subscribe to content changes; returns an unsubscribe fn. */
export const onLiveContentChange = (doc: Y.Doc, cb: (content: string) => void): (() => void) => {
  const text = doc.getText(LIVE_TEXT_KEY);
  const handler = () => cb(text.toString());
  text.observe(handler);
  return () => text.unobserve(handler);
};

/** The socket.io room name for a note's live document (per share, per note). */
export const liveRoom = (shareId: string, noteId: string): string => `mdlive:${shareId}:${noteId}`;
