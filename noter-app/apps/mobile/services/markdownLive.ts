/**
 * CRDT "Live" client connector (mobile) — Phase 2. Keeps a note's MARKDOWN content in
 * real-time sync over the app's socket.io CRDT relay when the note is in a Live-enabled
 * Markdown share. Content-level (store ↔ Y.Text), editor-agnostic, E2E-preserving (the
 * store re-encrypts). Defensive: a no-op when the socket is absent.
 */
import React from 'react';
import {
  createLiveDoc, reconcileLiveContent, applyLiveUpdate, onLiveUpdate, observeLiveContent,
  toBase64, fromBase64,
} from '@repo/shared';
import { getSocket } from '@/services/socket';
import { useStore } from '@/stores/useStore';
import { liveShareIdForNote } from '@/services/markdownShare';

export interface LiveHandle { pushLocal(content: string): void; disconnect(): void }

export function connectLiveNote(shareId: string, noteId: string, opts: { onRemoteContent: (content: string) => void }): LiveHandle | null {
  const socket = getSocket();
  if (!socket) return null;
  const doc = createLiveDoc('');
  const offUpdate = onLiveUpdate(doc, (update, isLocal) => {
    if (isLocal) { try { socket.emit('mdlive:update', { shareId, noteId, update: toBase64(update) }); } catch { /* ignore */ } }
  });
  const offContent = observeLiveContent(doc, (content, isRemote) => { if (isRemote) opts.onRemoteContent(content); });
  const onState = (p: any) => { if (p?.shareId === shareId && p?.noteId === noteId && p?.update) applyLiveUpdate(doc, fromBase64(p.update), 'remote'); };
  const onUpd = (p: any) => { if (p?.shareId === shareId && p?.noteId === noteId && p?.update) applyLiveUpdate(doc, fromBase64(p.update), 'remote'); };
  socket.on('mdlive:state', onState);
  socket.on('mdlive:update', onUpd);
  try { socket.emit('mdlive:join', { shareId, noteId }); } catch { /* ignore */ }
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
 * Hook: live-sync a specific note's content while its screen is open, IF the note is in a
 * Live share. Pass the note id + its current content; remote edits flow back via the store.
 */
export function useMarkdownLiveSync(noteId: string | null | undefined, content: string | undefined): void {
  const updateNote = useStore((s: any) => s.updateNote);
  const handleRef = React.useRef<LiveHandle | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const id = noteId ? String(noteId) : '';
    if (!id) return;
    (async () => {
      const shareId = await liveShareIdForNote(id).catch(() => null);
      if (cancelled || !shareId) return;
      handleRef.current = connectLiveNote(shareId, id, {
        onRemoteContent: (c) => { try { void updateNote(id, { content: c }); } catch { /* ignore */ } },
      });
      if (handleRef.current && typeof content === 'string') handleRef.current.pushLocal(content);
    })();
    return () => { cancelled = true; if (handleRef.current) { handleRef.current.disconnect(); handleRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  React.useEffect(() => {
    if (handleRef.current && typeof content === 'string') handleRef.current.pushLocal(content);
  }, [content]);
}
