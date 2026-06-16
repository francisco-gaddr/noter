/**
 * On-device GGUF model storage + robust, resumable, background download manager.
 *
 * Uses **expo-file-system** (new-architecture native). Files live under the app's
 * PRIVATE document directory. GGUF weights are public artifacts; the user's chats/
 * notes are E2E encrypted separately.
 *
 * Robustness (the download must "just work" through real life):
 *   - MODULE-OWNED: a download lives here, not in the screen that started it, so
 *     closing the download view / navigating away / app-switch never stops it.
 *   - BACKGROUND session (iOS) + a keep-awake lock (Android) keep the transfer alive
 *     through screen-lock / app-switch.
 *   - PAUSE / RESUME / CANCEL: user controls, exposed for a "downloads" UI.
 *   - SELF-HEALING on network loss: a transient failure is retried with backoff,
 *     resuming from the partial file instead of restarting.
 *   - SURVIVES APP KILL: each download's resume token (savable()) is persisted; on
 *     next launch resumePersistedDownloads() continues them from where they stopped.
 *   - OBSERVABLE: subscribeDownloads / getDownloadSnapshot let any screen re-attach
 *     to live progress, and every state change is broadcast.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { acquireKeepAwake } from './keepAwake';

export type DownloadStageValue = 'queued' | 'downloading' | 'paused' | 'retrying' | 'completed' | 'failed' | 'cancelled';
export interface DownloadState {
  modelId: string;
  percent: number;
  stage: DownloadStageValue;
  /** Human label for the downloads list (model name + quant). */
  name?: string;
  quantization?: string;
  bytesWritten?: number;
  totalBytes?: number;
  error?: string;
}

interface DownloadMeta { name?: string; quantization?: string; totalBytes?: number; url: string; target: string }
interface DownloadEntry {
  modelId: string;
  resumable: FileSystem.DownloadResumable;
  control: { paused: boolean; cancelled: boolean };
  meta: DownloadMeta;
  retries: number;
  bytesWritten: number;
}

const MAX_RETRIES = 6;
const REGISTRY_KEY = 'model_downloads_v1';

const activeDownloads = new Map<string, DownloadEntry>();
const downloadState = new Map<string, DownloadState>();
const listeners = new Set<(state: DownloadState) => void>();

const emit = (modelId: string, patch: Partial<DownloadState>) => {
  const prev = downloadState.get(modelId) || { modelId, percent: 0, stage: 'queued' as DownloadStageValue };
  const next: DownloadState = { ...prev, ...patch, modelId };
  downloadState.set(modelId, next);
  for (const cb of listeners) { try { cb(next); } catch { /* ignore */ } }
};
const clearState = (modelId: string) => { downloadState.delete(modelId); };

/** Subscribe to download progress/stage changes. Returns an unsubscribe fn. */
export const subscribeDownloads = (cb: (state: DownloadState) => void): (() => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
/** Current download states (active, paused, or just-finished) — for UI re-attach. */
export const getDownloadSnapshot = (): DownloadState[] => Array.from(downloadState.values());
/** Only the live (in-flight or paused) downloads — for a "downloads in progress" list. */
export const getActiveDownloads = (): DownloadState[] =>
  Array.from(downloadState.values()).filter((s) => s.stage === 'downloading' || s.stage === 'paused' || s.stage === 'retrying' || s.stage === 'queued');
export const isDownloading = (modelId: string): boolean => activeDownloads.has(modelId);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- Persisted registry (survives app kill) -------------------------------------
type Registry = Record<string, { url: string; target: string; quantization?: string; name?: string; totalBytes?: number; savable?: any }>;
const readRegistry = async (): Promise<Registry> => {
  try { const raw = await AsyncStorage.getItem(REGISTRY_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};
const writeRegistryEntry = async (modelId: string, entry: Registry[string] | null) => {
  try {
    const reg = await readRegistry();
    if (entry) reg[modelId] = entry; else delete reg[modelId];
    await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  } catch { /* best-effort */ }
};
let lastPersistAt: Record<string, number> = {};
const persistSavable = async (entry: DownloadEntry, force = false) => {
  const now = nowMs();
  if (!force && now - (lastPersistAt[entry.modelId] || 0) < 4000) return; // throttle disk writes
  lastPersistAt[entry.modelId] = now;
  let savable: any;
  try { savable = entry.resumable.savable(); } catch { savable = undefined; }
  await writeRegistryEntry(entry.modelId, {
    url: entry.meta.url, target: entry.meta.target, quantization: entry.meta.quantization,
    name: entry.meta.name, totalBytes: entry.meta.totalBytes, savable,
  });
};
// new Date() / Date.now() are fine in app code (only the workflow sandbox forbids them).
const nowMs = () => Date.now();

// ---- Paths -----------------------------------------------------------------------
const getBaseDir = (): string | null => {
  if (!FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}llama_models`;
};
const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_');

export const getModelPath = (modelId: string, quantization?: string): string | null => {
  const base = getBaseDir();
  if (!base) return null;
  const quant = (quantization || 'Q4_K_M').toUpperCase();
  return `${base}/${sanitize(modelId)}-${sanitize(quant)}.gguf`;
};

export const ensureModelsDir = async (): Promise<void> => {
  const base = getBaseDir();
  if (!base) throw new Error('Native filesystem not available');
  const info = await FileSystem.getInfoAsync(base);
  if (!info.exists) await FileSystem.makeDirectoryAsync(base, { intermediates: true });
};

export const modelFileExists = async (uri: string): Promise<boolean> => {
  try { const info = await FileSystem.getInfoAsync(uri); return info.exists; } catch { return false; }
};
export const deleteModelFile = async (uri: string): Promise<void> => {
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* ignore */ }
};

// ---- Controls --------------------------------------------------------------------
/** Cancel a download (the ONLY thing that stops it short of completion) + clean up. */
export const stopModelDownload = async (modelId: string): Promise<boolean> => {
  const entry = activeDownloads.get(modelId);
  if (entry) {
    entry.control.cancelled = true;
    try { await entry.resumable.cancelAsync(); } catch { /* already done */ }
    activeDownloads.delete(modelId);
  }
  emit(modelId, { percent: 0, stage: 'cancelled' });
  clearState(modelId);
  await writeRegistryEntry(modelId, null);
  const path = getModelPath(modelId);
  if (path) await deleteModelFile(path);
  return Boolean(entry);
};

/** Pause an in-flight download (keeps the partial file; resume later). */
export const pauseModelDownload = async (modelId: string): Promise<boolean> => {
  const entry = activeDownloads.get(modelId);
  if (!entry || entry.control.paused) return false;
  entry.control.paused = true;
  try { await entry.resumable.pauseAsync(); } catch { /* ignore */ }
  await persistSavable(entry, true);
  emit(modelId, { stage: 'paused' });
  return true;
};

/** Resume a paused download (the managed loop is waiting on the paused flag). */
export const resumeModelDownload = async (modelId: string): Promise<boolean> => {
  const entry = activeDownloads.get(modelId);
  if (!entry || !entry.control.paused) return false;
  entry.control.paused = false;
  entry.retries = 0;
  emit(modelId, { stage: 'downloading' });
  return true;
};

// ---- Core download loop ----------------------------------------------------------
class Cancelled extends Error {}

const makeResumable = (meta: DownloadMeta, modelId: string, resumeData?: string): FileSystem.DownloadResumable =>
  FileSystem.createDownloadResumable(
    meta.url,
    meta.target,
    { sessionType: FileSystem.FileSystemSessionType.BACKGROUND },
    (p) => {
      const total = p.totalBytesExpectedToWrite || meta.totalBytes || 0;
      const entry = activeDownloads.get(modelId);
      if (entry) entry.bytesWritten = p.totalBytesWritten;
      const percent = total > 0 ? p.totalBytesWritten / total : 0;
      emit(modelId, { percent, stage: 'downloading', bytesWritten: p.totalBytesWritten, totalBytes: total || undefined });
      if (entry) void persistSavable(entry);
    },
    resumeData,
  );

const runEntry = async (entry: DownloadEntry, alreadyStarted: boolean): Promise<string> => {
  const release = acquireKeepAwake();
  let started = alreadyStarted;
  try {
    for (;;) {
      if (entry.control.cancelled) throw new Cancelled();
      if (entry.control.paused) { await waitWhilePaused(entry); continue; }
      let result: FileSystem.FileSystemDownloadResult | undefined;
      try {
        result = started ? await entry.resumable.resumeAsync() : await entry.resumable.downloadAsync();
        started = true;
      } catch (err: any) {
        if (entry.control.cancelled) throw new Cancelled();
        if (entry.control.paused) continue; // pauseAsync can reject the in-flight call
        // Transient (network) error → retry from the partial file with backoff.
        entry.retries += 1;
        if (entry.retries > MAX_RETRIES) {
          emit(entry.modelId, { stage: 'failed', error: 'Nätverksfel — försök igen senare.' });
          throw err instanceof Error ? err : new Error('Download failed');
        }
        emit(entry.modelId, { stage: 'retrying', error: `Återförsök ${entry.retries}/${MAX_RETRIES}…` });
        await persistSavable(entry, true);
        await sleep(Math.min(30000, 1500 * 2 ** (entry.retries - 1))); // 1.5s,3s,6s… capped 30s
        try { entry.resumable = makeResumable(entry.meta, entry.modelId, savableResumeData(entry)); } catch { /* keep current */ }
        continue;
      }
      if (!result) {
        // undefined ⇒ paused or cancelled (cancelAsync/pauseAsync resolves to undefined).
        if (entry.control.cancelled) throw new Cancelled();
        if (entry.control.paused) continue;
        throw new Cancelled();
      }
      if (result.status !== 200 && result.status !== 206) {
        await deleteModelFile(entry.meta.target);
        emit(entry.modelId, { stage: 'failed', error: `HTTP ${result.status}` });
        throw new Error(`Download failed (HTTP ${result.status})`);
      }
      emit(entry.modelId, { percent: 1, stage: 'completed' });
      await writeRegistryEntry(entry.modelId, null);
      return entry.meta.target;
    }
  } finally {
    release();
    activeDownloads.delete(entry.modelId);
  }
};

const savableResumeData = (entry: DownloadEntry): string | undefined => {
  try { return (entry.resumable.savable() as any)?.resumeData; } catch { return undefined; }
};

const waitWhilePaused = async (entry: DownloadEntry): Promise<void> => {
  while (entry.control.paused && !entry.control.cancelled) {
    await sleep(400);
  }
};

/**
 * Download a GGUF model. Returns the absolute file:// path on success.
 * Resumable, retrying, pausable, and cancellable via the control functions above.
 */
export const downloadGgufModel = async (
  url: string,
  modelId: string,
  quantization?: string,
  onProgress?: (percent: number) => void,
  meta?: { name?: string; totalBytes?: number },
): Promise<string> => {
  await ensureModelsDir();
  const target = getModelPath(modelId, quantization);
  if (!target) throw new Error('Model directory unavailable');

  // If one is already running for this model, don't start a second.
  if (activeDownloads.has(modelId)) {
    throw new Error('En nedladdning pågår redan för den här modellen.');
  }

  // Fresh start: remove any stale partial so progress is correct.
  await deleteModelFile(target);

  const fullMeta: DownloadMeta = { url, target, quantization, name: meta?.name, totalBytes: meta?.totalBytes };
  const entry: DownloadEntry = {
    modelId,
    resumable: makeResumable(fullMeta, modelId),
    control: { paused: false, cancelled: false },
    meta: fullMeta,
    retries: 0,
    bytesWritten: 0,
  };
  activeDownloads.set(modelId, entry);
  emit(modelId, { percent: 0, stage: 'queued', name: meta?.name, quantization, totalBytes: meta?.totalBytes });
  await persistSavable(entry, true);

  // Bridge progress to the legacy onProgress callback too.
  if (onProgress) {
    const unsub = subscribeDownloads((s) => { if (s.modelId === modelId && typeof s.percent === 'number') onProgress(s.percent); });
    try { return await runEntry(entry, false); }
    catch (e) { if (e instanceof Cancelled) { clearState(modelId); throw new Error('Download cancelled'); } throw e; }
    finally { unsub(); }
  }
  try { return await runEntry(entry, false); }
  catch (e) { if (e instanceof Cancelled) { clearState(modelId); throw new Error('Download cancelled'); } throw e; }
};

/**
 * Re-attach to + resume any downloads that were interrupted by an app kill. Reads the
 * persisted registry, rebuilds each resumable from its saved resume token, and continues.
 * `onComplete(modelId, meta)` is called when a resumed download finishes, so the caller
 * can register the model in its local DB + refresh the list. Best-effort and idempotent.
 */
export const resumePersistedDownloads = async (
  onComplete?: (modelId: string, meta: { target: string; name?: string; quantization?: string; totalBytes?: number }) => void,
): Promise<void> => {
  const reg = await readRegistry();
  for (const [modelId, rec] of Object.entries(reg)) {
    if (activeDownloads.has(modelId)) continue;
    // Already finished on disk? clean the registry and skip.
    if (await modelFileExists(rec.target)) { await writeRegistryEntry(modelId, null); continue; }
    const fullMeta: DownloadMeta = { url: rec.url, target: rec.target, quantization: rec.quantization, name: rec.name, totalBytes: rec.totalBytes };
    const resumeData = rec.savable?.resumeData;
    const entry: DownloadEntry = {
      modelId,
      resumable: makeResumable(fullMeta, modelId, resumeData),
      control: { paused: false, cancelled: false },
      meta: fullMeta,
      retries: 0,
      bytesWritten: 0,
    };
    activeDownloads.set(modelId, entry);
    emit(modelId, { percent: 0, stage: 'retrying', name: rec.name, quantization: rec.quantization, totalBytes: rec.totalBytes });
    // Resume in the background; report completion so the model gets registered.
    void runEntry(entry, Boolean(resumeData))
      .then((target) => { onComplete?.(modelId, { target, name: rec.name, quantization: rec.quantization, totalBytes: rec.totalBytes }); })
      .catch(() => { /* stays failed/cancelled in state; registry kept for the next try unless cancelled */ });
  }
};

export const isNativeFileSystemAvailable = (): boolean => Boolean(FileSystem.documentDirectory);
