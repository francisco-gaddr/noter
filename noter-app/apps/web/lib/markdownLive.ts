'use client';

/**
 * CRDT "Live" client connector (web + Electron) — Phase 2.
 *
 * For a note that belongs to a Live-enabled Markdown share, this keeps the note's
 * MARKDOWN content in real-time sync over the app's socket.io CRDT relay: local edits are
 * relayed as Yjs updates, and remote edits are applied back to the note (re-encrypted by
 * the store, preserving E2E). We sync at the content level (store ↔ Y.Text), which is
 * robust and editor-agnostic; live cursors are a future polish.
 */
import React from 'react';
import {
  createLiveDoc, reconcileLiveContent, applyLiveUpdate, onLiveUpdate, observeLiveContent,
  toBase64, fromBase64,
} from '@repo/shared';
import { socket } from '../services/socket';
import { useStore } from '../stores/useStore';
import { liveShareIdForNote } from './markdownShare';

export interface LiveHandle { pushLocal(content: string): void; disconnect(): void }

export function connectLiveNote(shareId: string, noteId: string, opts: { token?: string; onRemoteContent: (content: string) => void }): LiveHandle {
  const doc = createLiveDoc('');
  const offUpdate = onLiveUpdate(doc, (update, isLocal) => {
    if (isLocal) { try { socket.emit('mdlive:update', { shareId, noteId, update: toBase64(update) }); } catch { /* ignore */ } }
  });
  const offContent = observeLiveContent(doc, (content, isRemote) => { if (isRemote) opts.onRemoteContent(content); });
  const onState = (p: any) => { if (p?.shareId === shareId && p?.noteId === noteId && p?.update) applyLiveUpdate(doc, fromBase64(p.update), 'remote'); };
  const onUpd = (p: any) => { if (p?.shareId === shareId && p?.noteId === noteId && p?.update) applyLiveUpdate(doc, fromBase64(p.update), 'remote'); };
  socket.on('mdlive:state', onState);
  socket.on('mdlive:update', onUpd);
  try { socket.emit('mdlive:join', { shareId, noteId, ...(opts.token ? { token: opts.token } : {}) }); } catch { /* ignore */ }
  return {
    pushLocal(content: string) { reconcileLiveContent(doc, content); },
    disconnect() {
      offUpdate(); offContent();
      socket.off('mdlive:state', onState);
      socket.off('mdlive:update', onUpd);
      try { socket.emit('mdlive:leave', { shareId, noteId }); } catch { /* ignore */ }
    },
  };
}

/**
 * Hook: keep the currently-selected note live-synced when it belongs to a Live share.
 * Mount once near the app root. No-op for notes not in a Live share.
 */
export function useMarkdownLiveSync(): void {
  const selectedNoteId = useStore((s: any) => s.selectedNoteId);
  const notes = useStore((s: any) => s.notes);
  const updateNote = useStore((s: any) => s.updateNote);

  const handleRef = React.useRef<LiveHandle | null>(null);
  const noteRef = React.useRef<string | null>(null);

  // (Re)connect when the selected note (that is in a Live share) changes.
  React.useEffect(() => {
    const id = selectedNoteId ? String(selectedNoteId) : '';
    const shareId = id ? liveShareIdForNote(id) : null;
    if (!shareId) {
      if (handleRef.current) { handleRef.current.disconnect(); handleRef.current = null; noteRef.current = null; }
      return;
    }
    if (noteRef.current === id && handleRef.current) return;
    if (handleRef.current) handleRef.current.disconnect();
    noteRef.current = id;
    handleRef.current = connectLiveNote(shareId, id, {
      onRemoteContent: (content) => { try { void updateNote(id, { content }); } catch { /* ignore */ } },
    });
    // Seed the room with the note's current content.
    const cur = (notes || []).find((n: any) => n._id === id);
    if (cur && typeof cur.content === 'string') handleRef.current.pushLocal(cur.content);
    return () => { if (handleRef.current) { handleRef.current.disconnect(); handleRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoteId]);

  // Relay local content edits of the active live note.
  React.useEffect(() => {
    const id = noteRef.current;
    if (!id || !handleRef.current) return;
    const cur = (notes || []).find((n: any) => n._id === id);
    if (cur && typeof cur.content === 'string') handleRef.current.pushLocal(cur.content);
  }, [notes]);
}
