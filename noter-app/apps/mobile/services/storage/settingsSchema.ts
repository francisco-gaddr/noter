import { z } from 'zod';

/**
 * Canonical schema for everything we persist under user settings.
 *
 * Why a schema: the settings file is read on cold-start before any UI mounts.
 * If a stored value is the wrong type (corrupt write, manual edit, version
 * mismatch from a future build), the safest thing is to substitute the
 * default rather than crash with `cannot read property of undefined` deep
 * inside a component.
 *
 * Use:
 *   const settings = parseSettings(rawJson);  // never throws, may use defaults
 *
 * Adding a field: extend `SettingsSchema` with a `.default(...)`. Old
 * persisted blobs without the field auto-pick up the default on next read.
 */

export const SettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  notificationsEnabled: z.boolean().default(true),
  securityLocked: z.boolean().default(false),
  apiUrl: z.string().url().optional(),
  // List view preference per screen.
  notesSortBy: z.enum(['createdAt', 'updatedAt', 'title', 'custom']).default('custom'),
  notesSortOrder: z.enum(['asc', 'desc']).default('desc'),
  notesVariant: z.enum(['compact', 'cards']).default('compact'),
  // AI per-user prompts. Keyed by scope ('global', 'note:<id>', etc.).
  aiSystemPrompts: z.record(z.string(), z.string().max(8000)).default({}),
  aiToolUseEnabled: z.record(z.string(), z.boolean()).default({}),
  // Tutorial / "what's new" gates.
  whatsNewSeenVersion: z.string().optional(),
  // Storage migration sentinel — owned by services/storage/kv.ts.
  __kvMigrationVersion: z.number().int().nonnegative().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/**
 * Parse a possibly-corrupt settings payload. NEVER throws. Returns
 *   { settings, healed }
 * where `healed` is true if any field had to be substituted with its default.
 * Callers can persist the healed copy back to storage to avoid repeating
 * the heal on every cold start.
 */
export const parseSettings = (raw: unknown): { settings: Settings; healed: boolean } => {
  // First try a strict parse — if everything is exactly right we know no
  // healing happened.
  const strict = SettingsSchema.safeParse(raw);
  if (strict.success) {
    // Even a "successful" parse can have applied defaults to missing fields.
    // Detect that by comparing key-count of input object to schema output.
    const inputKeys = raw && typeof raw === 'object' ? Object.keys(raw as object).length : 0;
    const outputKeys = Object.keys(strict.data).length;
    return { settings: strict.data, healed: outputKeys > inputKeys };
  }

  // Strict parse failed; walk the object and accept what we can, drop the rest.
  if (!raw || typeof raw !== 'object') {
    return { settings: { ...DEFAULT_SETTINGS }, healed: true };
  }
  const partial: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Try each field individually against its zod schema.
    const shape = (SettingsSchema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    const fieldSchema = shape[key];
    if (!fieldSchema) continue;
    const result = fieldSchema.safeParse(value);
    if (result.success) partial[key] = result.data;
  }
  const merged = SettingsSchema.safeParse(partial);
  if (merged.success) return { settings: merged.data, healed: true };
  return { settings: { ...DEFAULT_SETTINGS }, healed: true };
};

/**
 * Parse a JSON string, with the same guarantees as parseSettings.
 */
export const parseSettingsJson = (raw: string | null | undefined): { settings: Settings; healed: boolean } => {
  if (!raw) return { settings: { ...DEFAULT_SETTINGS }, healed: false };
  try {
    return parseSettings(JSON.parse(raw));
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, healed: true };
  }
};
