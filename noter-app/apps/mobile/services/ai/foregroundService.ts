/**
 * Android foreground service for long-running on-device AI work.
 *
 * Without a foreground service Android suspends a backgrounded app within seconds, so a
 * local model (or a scheduled agent run) stopped when the user switched away — even with
 * "AI work in background" enabled. A foreground service keeps the process alive while the
 * work runs, shown as a persistent notification (Android requires one). Started only when
 * AI is ACTUALLY working AND the user enabled background work; stopped the moment work ends.
 *
 * Hard platform limits (honest): iOS does NOT allow arbitrary long-running background
 * compute (best-effort ~30s–3min), and nothing runs while the phone is powered off — there
 * we fall back to keeping the model resident so work resumes the instant you return.
 *
 * Defensive: the native module is only present in an EAS build. require() is wrapped so
 * this is a safe no-op in Expo Go / before the next build (never crashes).
 */
import { Platform } from 'react-native';

type BgService = {
  start: (task: (args?: any) => Promise<void>, options: any) => Promise<void>;
  stop: () => Promise<void>;
  updateNotification: (options: any) => Promise<void>;
  isRunning: () => boolean;
};

let BG: BgService | null = null;
try {
  // Bundled JS is always resolvable; the NATIVE side only exists in an EAS build, so any
  // call is additionally guarded below.
  BG = require('react-native-background-actions').default as BgService;
} catch {
  BG = null;
}

// Ref-counted: a chat generation AND an agent run can overlap; the service stays up until
// the last holder releases.
let holders = 0;
let starting: Promise<void> | null = null;

const sleepForever = () => new Promise<void>(() => { /* resolved never; we stop via BG.stop() */ });

const OPTIONS = {
  taskName: 'NoterAI',
  taskTitle: 'Noter — AI arbetar',
  taskDesc: 'AI-modellen arbetar i bakgrunden',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  linkingURI: 'noter://',
  // Android 14+ foreground-service type; matches the data-sync permission in app.json.
  // (Ignored on older Androids / by older lib versions.)
  // @ts-ignore — passed through to the native options bag.
  foregroundServiceType: 'dataSync',
};

/** Begin keeping the process alive for AI work (Android only). Best-effort + idempotent. */
export const startAiForegroundService = async (): Promise<void> => {
  if (!BG || Platform.OS !== 'android') return; // iOS / web: rely on keep-awake + resume-on-return
  holders += 1;
  if (holders > 1) return;
  try {
    if (BG.isRunning?.()) return;
    starting = BG.start(sleepForever, OPTIONS);
    await starting;
  } catch {
    // Native module absent (pre-build) or start failed — degrade silently.
    holders = Math.max(0, holders - 1);
  } finally {
    starting = null;
  }
};

/** Release one hold; stops the service when no AI work remains. */
export const stopAiForegroundService = async (): Promise<void> => {
  if (!BG || Platform.OS !== 'android') return;
  holders = Math.max(0, holders - 1);
  if (holders > 0) return;
  try { if (starting) await starting; } catch { /* ignore */ }
  try { await BG.stop(); } catch { /* ignore */ }
};
