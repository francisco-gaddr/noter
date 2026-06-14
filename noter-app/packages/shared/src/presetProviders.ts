/**
 * Per-user pre-seeded AI providers.
 *
 * Some users have private self-hosted "Hermes" agents (Ollama / LM Studio) on
 * their own network. We pre-fill those connections ONLY for that specific user so
 * they don't have to configure them by hand — and never for anyone else (another
 * account sees nothing unless they add their own). The endpoints are LAN/tailnet
 * addresses that are only reachable from the user's own network or VPN, so
 * shipping them in the bundle leaks nothing usable.
 *
 * Each preset is a normal custom provider (OpenAI-compatible endpoint reusing the
 * Hermes send path). They are merged into the user's custom-provider list on load
 * if missing (by id), and remain fully editable/removable afterwards.
 */
export type PresetProvider = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

// princefranspadi — Hermes agents on the Pi (Ollama) and the Mac (LM Studio).
// Pi via the tailnet address so it works over VPN; Mac via LAN. No API key
// (self-hosted). Models are sensible defaults the user can change.
const HERMES_PRESETS: PresetProvider[] = [
  {
    id: 'preset-hermes-pi-ollama',
    label: 'Hermes – Pi (Ollama)',
    baseUrl: 'http://100.64.0.2:11434',
    model: 'qwen2.5:3b-instruct',
    apiKey: '',
  },
  {
    id: 'preset-hermes-mac-lmstudio',
    label: 'Hermes – Mac (LM Studio)',
    baseUrl: 'http://192.168.50.10:1234',
    model: 'local-model',
    apiKey: '',
  },
];

const PRESETS_BY_USERNAME: Record<string, PresetProvider[]> = {
  // Canonical username (the user corrected the spelling); keep the earlier
  // misspelling as an alias so an already-provisioned account keeps working.
  princefranspadi: HERMES_PRESETS,
  prrincefranspadi: HERMES_PRESETS,
};

/** Normalize a username/email to the lookup key (lowercased local part). */
const normalizeUser = (username?: string | null): string => {
  const raw = (username || '').trim().toLowerCase();
  // Accept an email too — match on the local part before '@'.
  return raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw;
};

/** Preset custom providers for this user (empty array for everyone else). */
export const getPresetCustomProviders = (username?: string | null): PresetProvider[] => {
  const list = PRESETS_BY_USERNAME[normalizeUser(username)];
  return list ? list.map((p) => ({ ...p })) : [];
};

/**
 * Merge a user's presets into their existing custom providers, adding only the
 * ones not already present (by id). Existing entries (incl. user edits) win.
 * Returns the original array reference when nothing was added so callers can skip
 * a needless re-save.
 */
export const mergePresetProviders = <T extends { id: string }>(
  existing: T[],
  username?: string | null,
): { merged: T[]; added: boolean } => {
  const presets = getPresetCustomProviders(username);
  if (!presets.length) return { merged: existing, added: false };
  const haveIds = new Set(existing.map((p) => p.id));
  const toAdd = presets.filter((p) => !haveIds.has(p.id)) as unknown as T[];
  if (!toAdd.length) return { merged: existing, added: false };
  return { merged: [...existing, ...toAdd], added: true };
};
