import type { Server, Socket } from 'socket.io';
import {
  createLiveDoc, applyLiveUpdate, encodeLiveState, getLiveContent,
  fromBase64, toBase64, liveRoom, renderVaultFile, fileEtag,
} from '@repo/shared';
import * as Y from 'yjs';
import { randomBytes } from 'node:crypto';
import MarkdownShare from '../models/MarkdownShare';
import { verifyDavPassword } from '../caldav/credentials';
import { isMarkdownCrdtEnabled } from '../config/markdownExposure';
import logger from '../utils/logger';

/**
 * CRDT "Live" relay (Phase 2) over the app's existing JWT-authed socket.io. One Yjs
 * document per (share, note). The server holds the authoritative Y.Doc, relays binary
 * updates between peers (the owner's apps + external Obsidian/Relay clients), persists
 * the merged plaintext into the share's projection, and enqueues a durable mutation so
 * an OFFLINE owner catches up + re-encrypts. E2E is preserved: the doc only ever holds
 * the SHARED note's plaintext (opt-in), and the owner's client is what re-encrypts it.
 *
 * Auth to a room: EITHER the authenticated owner (socket JWT userId === share.userId) OR
 * a valid per-share CRDT token (hash match). Requires the channel + the share's crdt mode.
 */

interface RoomState { doc: Y.Doc; shareId: string; noteId: string; members: number; persistTimer?: NodeJS.Timeout }
const rooms = new Map<string, RoomState>();

const getOrCreateRoom = (shareId: string, noteId: string, initialContent: string): RoomState => {
  const key = liveRoom(shareId, noteId);
  let r = rooms.get(key);
  if (!r) {
    r = { doc: createLiveDoc(initialContent), shareId, noteId, members: 0 };
    rooms.set(key, r);
  }
  return r;
};

const schedulePersist = (io: Server, r: RoomState): void => {
  if (r.persistTimer) return;
  r.persistTimer = setTimeout(async () => {
    r.persistTimer = undefined;
    try {
      const content = getLiveContent(r.doc);
      const share = await MarkdownShare.findOne({ shareId: r.shareId });
      if (!share) return;
      const file = (share.files || []).find((f) => f.noteId === r.noteId);
      if (!file) return;
      if (file.body === content) return; // nothing changed
      file.body = content;
      file.etag = fileEtag({ noteId: file.noteId, title: file.title, body: content, tags: file.tags, type: file.type });
      // Durable bridge: enqueue an upsert so an offline owner re-applies it with the key.
      const rendered = renderVaultFile(file as any);
      const mutation = { id: randomBytes(8).toString('hex'), op: 'upsert' as const, path: file.path, destination: null, body: rendered, at: new Date() };
      await MarkdownShare.updateOne({ _id: share._id }, { $pull: { pendingMutations: { path: file.path } } });
      await MarkdownShare.updateOne(
        { _id: share._id },
        { $set: { files: share.files, updatedAt: new Date() }, $push: { pendingMutations: { $each: [mutation], $slice: -500 } } },
      );
      io.to(`user:${share.userId}`).emit('markdown:mutation', { shareId: share.shareId, path: file.path, op: 'upsert' });
    } catch (err) {
      logger.warn('mdlive persist failed', { error: (err as Error)?.message });
    }
  }, 1500);
};

const authorize = async (shareId: string, noteId: string, token: string | undefined, userId: string | undefined) => {
  if (!isMarkdownCrdtEnabled()) return null;
  const share = await MarkdownShare.findOne({ shareId }).lean().catch(() => null);
  if (!share || !share.modes?.crdt) return null;
  const isOwner = !!userId && String(share.userId) === String(userId);
  const tokenOk = !!token && !!share.crdtTokenHash && verifyDavPassword(token, share.crdtTokenHash);
  if (!isOwner && !tokenOk) return null;
  const file = (share.files || []).find((f) => f.noteId === noteId);
  if (!file) return null; // only notes in the opt-in projection are live-editable
  return { share, file };
};

/** Register the Live relay handlers on a freshly-connected socket. */
export const registerMarkdownLive = (io: Server, socket: Socket, userId?: string): void => {
  const joined = new Set<string>();

  socket.on('mdlive:join', async (payload: { shareId?: string; noteId?: string; token?: string }) => {
    try {
      const shareId = String(payload?.shareId || '');
      const noteId = String(payload?.noteId || '');
      if (!shareId || !noteId) return;
      const ok = await authorize(shareId, noteId, payload?.token, userId);
      if (!ok) { socket.emit('mdlive:denied', { shareId, noteId }); return; }
      const key = liveRoom(shareId, noteId);
      const room = getOrCreateRoom(shareId, noteId, ok.file.body || '');
      room.members += 1;
      joined.add(key);
      socket.join(key);
      socket.emit('mdlive:state', { shareId, noteId, update: toBase64(encodeLiveState(room.doc)) });
    } catch (err) {
      logger.warn('mdlive join failed', { error: (err as Error)?.message });
    }
  });

  socket.on('mdlive:update', async (payload: { shareId?: string; noteId?: string; update?: string }) => {
    try {
      const shareId = String(payload?.shareId || '');
      const noteId = String(payload?.noteId || '');
      const key = liveRoom(shareId, noteId);
      if (!joined.has(key) || !payload?.update) return; // must have joined (authorized) this room
      const room = rooms.get(key);
      if (!room) return;
      applyLiveUpdate(room.doc, fromBase64(String(payload.update)));
      socket.to(key).emit('mdlive:update', { shareId, noteId, update: payload.update });
      schedulePersist(io, room);
    } catch (err) {
      logger.warn('mdlive update failed', { error: (err as Error)?.message });
    }
  });

  const leave = (key: string) => {
    if (!joined.has(key)) return;
    joined.delete(key);
    socket.leave(key);
    const room = rooms.get(key);
    if (room) {
      room.members -= 1;
      if (room.members <= 0) { if (room.persistTimer) clearTimeout(room.persistTimer); rooms.delete(key); }
    }
  };

  socket.on('mdlive:leave', (payload: { shareId?: string; noteId?: string }) => {
    leave(liveRoom(String(payload?.shareId || ''), String(payload?.noteId || '')));
  });

  socket.on('disconnecting', () => { for (const key of [...joined]) leave(key); });
};
