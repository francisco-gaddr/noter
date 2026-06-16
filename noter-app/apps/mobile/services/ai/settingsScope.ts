/**
 * Stable per-user scope for locally-stored AI settings.
 *
 * The bug this fixes: AI settings (provider, model, API keys, system prompt, context
 * level, …) were namespaced by SHA-256 of the auth *token*. A JWT changes on every
 * login (new iat/exp), so each login produced a NEW scope and the previous settings
 * became unreachable — i.e. they were "forgotten" on re-login (exactly what the user
 * reported). Persistence across plain app restarts worked (same token), but a fresh
 * login silently lost everything.
 *
 * Fix: derive the scope from the JWT's stable `userId` claim instead of the token
 * string, so the same user always lands on the same scope. A one-time migration copies
 * any settings saved under the old token-hash scope onto the new stable scope so
 * nothing is lost on upgrade. We never trust the decoded claim for auth — it is only a
 * local namespace key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// Settings stored in AsyncStorage (non-secret), keyed `${key}_${scope}`.
export const AI_ASYNC_SETTING_KEYS = [
  'ai_system_prompt', 'ai_tool_use_enabled', 'ai_chat_context_level', 'ai_retrieval_settings', 'ai_local_convert',
  'ai_attachments_enabled', 'ai_next_thread_local_only', 'ai_background_work',
  'ai_api_enabled', 'ai_api_provider', 'ai_openrouter_model', 'ai_gemini_model',
  'ai_groq_model', 'ai_openai_model', 'ai_anthropic_model', 'ai_grok_model',
  'ai_hermes_model', 'ai_hermes_base_url',
  'embeddings_config', 'embeddings_index', 'ai_active_project',
];
// Secrets stored in SecureStore (encrypted), keyed `${key}_${scope}`.
export const AI_SECURE_SETTING_KEYS = [
  'ai_custom_providers', 'ai_openrouter_key', 'ai_gemini_key', 'ai_groq_key',
  'ai_openai_key', 'ai_anthropic_key', 'ai_grok_key',
  'ai_hermes_key', 'ai_mcp_settings', 'embeddings_api_key',
];

// Minimal, dependency-free base64url decode (JWT payloads are ASCII JSON) — avoids
// relying on atob/Buffer being present in the RN runtime.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64UrlDecode = (input: string): string => {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < clean.length; i += 1) {
    const idx = B64.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((value >> bits) & 0xff); }
  }
  return out;
};

/** Decode the stable `userId`/`id`/`sub` claim from a JWT (no signature check). */
export const decodeJwtUserId = (token?: string | null): string | null => {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const obj = JSON.parse(base64UrlDecode(parts[1]));
    const id = obj?.userId ?? obj?.id ?? obj?.sub;
    if (id == null || id === '') return null;
    return typeof id === 'string' ? id : String(id);
  } catch {
    return null;
  }
};

/** The stable scope string for a token, or 'anon' when logged out / undecodable. */
export const stableScopeForToken = (token?: string | null): string => {
  const userId = decodeJwtUserId(token);
  return userId ? `u_${userId}` : 'anon';
};

let migratedFor: string | null = null;

/**
 * Resolve the AI-settings scope for the current token: the stable per-user scope, and
 * (once) migrate any settings stored under the legacy token-hash scope onto it so an
 * upgrade doesn't lose existing settings. Safe to call repeatedly.
 */
export const resolveAiSettingsScope = async (): Promise<string> => {
  const token = await SecureStore.getItemAsync('token').catch(() => null);
  const stable = stableScopeForToken(token);
  if (stable === 'anon' || !token) return stable;
  if (migratedFor === stable) return stable;

  try {
    const legacy = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token);
    if (legacy && legacy !== stable) {
      // Only migrate if the stable scope has nothing yet (don't clobber newer settings).
      const sentinel = `ai_scope_migrated_${stable}`;
      const already = await AsyncStorage.getItem(sentinel);
      if (!already) {
        for (const key of AI_ASYNC_SETTING_KEYS) {
          const dest = await AsyncStorage.getItem(`${key}_${stable}`);
          if (dest != null) continue;
          const src = await AsyncStorage.getItem(`${key}_${legacy}`);
          if (src != null) await AsyncStorage.setItem(`${key}_${stable}`, src);
        }
        for (const key of AI_SECURE_SETTING_KEYS) {
          const dest = await SecureStore.getItemAsync(`${key}_${stable}`).catch(() => null);
          if (dest != null) continue;
          const src = await SecureStore.getItemAsync(`${key}_${legacy}`).catch(() => null);
          if (src != null) await SecureStore.setItemAsync(`${key}_${stable}`, src).catch(() => {});
        }
        await AsyncStorage.setItem(sentinel, '1');
      }
    }
  } catch {
    /* migration is best-effort; stable scope is still returned */
  }
  migratedFor = stable;
  return stable;
};
