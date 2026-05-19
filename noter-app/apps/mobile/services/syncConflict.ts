/**
 * Sync-conflict resolution helpers.
 *
 * When the same note has been edited both locally (while offline) and on
 * the server (from another device), naïve "last write wins" can lose
 * data. These helpers detect the three-way diff against a common base
 * and either auto-merge (if changes are in disjoint fields) or ask the
 * user via the `useConflictPrompt` hook.
 *
 * Pure functions live here so the resolver can be unit-tested without RN.
 * The UI prompt-presentation lives in components/ — caller wires it up.
 */

export interface ConflictInput<T extends Record<string, unknown>> {
  base: T;   // last-known-good (the state before either side edited)
  local: T;  // what the device thinks the note is
  remote: T; // what the server says
}

export type ConflictResolution<T> =
  | { kind: 'auto-merge'; merged: T; touchedFields: string[] }
  | { kind: 'identical'; merged: T }
  | { kind: 'remote-only'; merged: T; touchedFields: string[] }
  | { kind: 'local-only'; merged: T; touchedFields: string[] }
  | { kind: 'requires-prompt'; conflicts: Array<{ field: string; base: unknown; local: unknown; remote: unknown }> };

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
};

/**
 * 3-way merge:
 *   - If local and remote are identical → identical
 *   - For each field independently:
 *       local == base && remote != base → use remote
 *       remote == base && local != base → use local
 *       both diverged from base AND from each other → conflict
 *
 * If every diverging field resolves uniquely (one side equals base), we
 * auto-merge. If any field has both sides changed differently, we
 * return 'requires-prompt' with the offending fields. The UI layer can
 * then ask the user (or apply a per-field default strategy).
 */
export const resolveConflict = <T extends Record<string, unknown>>(input: ConflictInput<T>): ConflictResolution<T> => {
  const { base, local, remote } = input;
  if (deepEqual(local, remote)) {
    return { kind: 'identical', merged: local };
  }

  const allKeys = new Set<string>();
  for (const k of Object.keys(base)) allKeys.add(k);
  for (const k of Object.keys(local)) allKeys.add(k);
  for (const k of Object.keys(remote)) allKeys.add(k);

  const merged: Record<string, unknown> = {};
  const touched: string[] = [];
  const conflicts: Array<{ field: string; base: unknown; local: unknown; remote: unknown }> = [];
  let anyLocal = false;
  let anyRemote = false;

  for (const key of allKeys) {
    const b = (base as Record<string, unknown>)[key];
    const l = (local as Record<string, unknown>)[key];
    const r = (remote as Record<string, unknown>)[key];
    const localChanged = !deepEqual(l, b);
    const remoteChanged = !deepEqual(r, b);

    if (!localChanged && !remoteChanged) {
      merged[key] = b;
      continue;
    }
    if (localChanged && !remoteChanged) {
      merged[key] = l;
      touched.push(key);
      anyLocal = true;
      continue;
    }
    if (!localChanged && remoteChanged) {
      merged[key] = r;
      touched.push(key);
      anyRemote = true;
      continue;
    }
    // both changed
    if (deepEqual(l, r)) {
      // Same edit on both sides — no actual conflict.
      merged[key] = l;
      touched.push(key);
      anyLocal = true;
      anyRemote = true;
      continue;
    }
    conflicts.push({ field: key, base: b, local: l, remote: r });
  }

  if (conflicts.length > 0) {
    return { kind: 'requires-prompt', conflicts };
  }
  if (anyLocal && anyRemote) {
    return { kind: 'auto-merge', merged: merged as T, touchedFields: touched };
  }
  if (anyLocal) {
    return { kind: 'local-only', merged: merged as T, touchedFields: touched };
  }
  return { kind: 'remote-only', merged: merged as T, touchedFields: touched };
};

/**
 * Apply a user's per-field choice to a conflict resolution.
 * choices: { [field]: 'local' | 'remote' | { kind: 'custom'; value: unknown } }
 */
export const applyConflictChoices = <T extends Record<string, unknown>>(
  input: ConflictInput<T>,
  conflicts: Array<{ field: string; base: unknown; local: unknown; remote: unknown }>,
  choices: Record<string, 'local' | 'remote' | { kind: 'custom'; value: unknown }>,
): T => {
  // Start from the auto-merge of non-conflicting fields by re-running and
  // picking up the non-prompt branch (we know which fields conflict).
  const conflictFieldSet = new Set(conflicts.map((c) => c.field));
  const stripped = { ...input.base, ...input.local, ...input.remote };
  for (const f of conflictFieldSet) delete (stripped as Record<string, unknown>)[f];
  const merged: Record<string, unknown> = { ...stripped };

  for (const c of conflicts) {
    const choice = choices[c.field];
    if (!choice) {
      // No explicit choice — default to local (offline-first).
      merged[c.field] = c.local;
      continue;
    }
    if (choice === 'local') merged[c.field] = c.local;
    else if (choice === 'remote') merged[c.field] = c.remote;
    else if (choice && typeof choice === 'object' && choice.kind === 'custom') merged[c.field] = choice.value;
  }
  return merged as T;
};

// Test helpers
export const _deepEqual = deepEqual;
