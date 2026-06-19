/**
 * Auto-index wiring (mobile). Mirror of the web module: when the user enables auto-index (default
 * OFF), re-embed readable notes/tasks shortly after they change. One debounced, overlap-guarded,
 * opt-in, best-effort store subscription. getEmbeddingsConfig is async on mobile. Locked content is
 * excluded by indexEntities' lock guard (empty unlock set).
 */
import { createDebounced } from '@repo/shared';
import { useStore } from '../../stores/useStore';
import { getEmbeddingsConfig, indexEntities } from './embeddingsService';

const AUTO_INDEX_DEBOUNCE_MS = 8000;

let inFlight = false;
const runAutoIndex = async (): Promise<void> => {
  if (inFlight) return;
  inFlight = true;
  try {
    const cfg = await getEmbeddingsConfig();
    if (!cfg.enabled || !cfg.autoIndex) return;
    const s: any = useStore.getState();
    await indexEntities(s.notes || [], s.tasks || [], new Set<string>());
  } catch { /* best-effort: never disrupt the app */ }
  finally { inFlight = false; }
};

const scheduleAutoIndex = createDebounced(runAutoIndex, AUTO_INDEX_DEBOUNCE_MS);

/** Start watching note/task changes; (debounced) re-index when auto-index is on. Returns unsubscribe. */
export const startAutoIndex = (): (() => void) => {
  const unsub = useStore.subscribe((state: any, prev: any) => {
    if (state.notes !== prev?.notes || state.tasks !== prev?.tasks) scheduleAutoIndex();
  });
  return () => { unsub(); scheduleAutoIndex.cancel(); };
};
