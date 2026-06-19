/**
 * Auto-index wiring (web/Electron). When the user enables "Indexera om automatiskt vid sparning"
 * (embeddings settings, default OFF), re-embed the readable notes/tasks shortly after they change,
 * so semantic search stays fresh without a manual "Indexera nu". A single store subscription is the
 * one trigger point (no per-mutation wiring); the work is heavily debounced (rapid edits coalesce),
 * guarded against overlap, gated on the opt-in flag, and entirely best-effort (never disrupts the
 * app). Locked content is excluded by indexEntities' lock guard (empty unlock set).
 */
import { createDebounced } from '@repo/shared';
import { useStore } from '../../stores/useStore';
import { getEmbeddingsConfig, indexEntities } from './embeddingsService';

const AUTO_INDEX_DEBOUNCE_MS = 8000;

let inFlight = false;
const runAutoIndex = async (): Promise<void> => {
  if (inFlight) return;
  const cfg = getEmbeddingsConfig();
  if (!cfg.enabled || !cfg.autoIndex) return;
  inFlight = true;
  try {
    const s: any = useStore.getState();
    await indexEntities(s.notes || [], s.tasks || [], new Set<string>());
  } catch { /* best-effort: a failed auto-index must never surface to the user */ }
  finally { inFlight = false; }
};

const scheduleAutoIndex = createDebounced(runAutoIndex, AUTO_INDEX_DEBOUNCE_MS);

/**
 * Start watching note/task changes and (debounced) re-index when auto-index is enabled.
 * Returns an unsubscribe function — call it on teardown.
 */
export const startAutoIndex = (): (() => void) => {
  const unsub = useStore.subscribe((state: any, prev: any) => {
    if (state.notes !== prev?.notes || state.tasks !== prev?.tasks) scheduleAutoIndex();
  });
  return () => { unsub(); scheduleAutoIndex.cancel(); };
};
