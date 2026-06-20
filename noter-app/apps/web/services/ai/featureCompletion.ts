import { decrypt, type FeatureAiConfig, type FeatureAiSource } from '@repo/shared'
import type { ChatMessage } from '@repo/ai'
import { API_PROVIDERS, generateApiProviderResponse, type ApiProviderType } from './apiProviders'

/**
 * Reusable AI source/model resolution for the creative features (flashcards, daily-review, voice).
 * Lets each feature pick a SOURCE (local on-device / API provider / custom Hermes) + MODEL, reusing
 * the provider keys the user already configured in the assistant — no duplicated key storage.
 */

const SENSITIVE = /(apikey|token|password|secret)/i
const getStored = async (key: string): Promise<string | null> => {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mlc = (window as any).mlc
  if (mlc?.isElectron && mlc.getSetting) { const v = await mlc.getSetting(key); return v ?? null }
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(key)
  if (raw == null) return null
  if (SENSITIVE.test(key)) { try { return decrypt(raw) || raw } catch { return raw } }
  return raw
}

interface CustomProvider { id: string; label?: string; baseUrl?: string; model?: string; apiKey?: string }
const getCustomProviders = async (): Promise<CustomProvider[]> => {
  try { const raw = await getStored('aiCustomProviders'); return raw ? (JSON.parse(raw) || []) : [] } catch { return [] }
}

export interface AiOption {
  /** Stable id used in the picker + stored in FeatureAiConfig.provider. */
  id: string
  label: string
  source: FeatureAiSource
  /** Suggested/default model for this source. */
  model: string
  /** Candidate models to offer in the picker (may be empty → free text). */
  models: string[]
}

/** Enumerate the sources the user has actually configured (a key present, a custom endpoint, or a
 *  local on-device model). What the feature's source/model picker shows. */
export const listAiOptions = async (): Promise<AiOption[]> => {
  const out: AiOption[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mlc = (window as any)?.mlc
  if (mlc?.isElectron) {
    const modelPath = (await getStored('mlcModelPath')) || ''
    if (modelPath) out.push({ id: 'local', label: 'Lokal (on-device)', source: 'local', model: modelPath, models: [modelPath] })
  }
  for (const id of Object.keys(API_PROVIDERS) as ApiProviderType[]) {
    const meta = API_PROVIDERS[id]
    const key = (await getStored(`${id}ApiKey`)) || ''
    if (!key && !meta.apiKeyOptional) continue
    const model = (await getStored(`${id}Model`)) || meta.defaultModels[0] || ''
    out.push({ id, label: meta.label, source: id === 'hermes' ? 'hermes' : 'api', model, models: meta.defaultModels })
  }
  for (const c of await getCustomProviders()) {
    out.push({ id: c.id, label: c.label || c.id, source: 'hermes', model: c.model || '', models: c.model ? [c.model] : [] })
  }
  return out
}

/** Resolve a chosen {source, provider, model} → run a one-shot completion. Throws a readable error if
 *  the chosen source isn't usable (no key, no local engine). */
export const runFeatureCompletion = async (cfg: FeatureAiConfig, system: string, prompt: string, signal?: AbortSignal): Promise<string> => {
  const history: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: prompt }]

  if (cfg.source === 'local') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mlc = (window as any)?.mlc
    if (!mlc) throw new Error('Lokal modell är bara tillgänglig i skrivbordsappen (Electron).')
    if (typeof mlc.generate === 'function') {
      const res = await mlc.generate({ model: cfg.model, messages: history })
      return (typeof res === 'string' ? res : res?.message?.content || res?.text || '').trim()
    }
    throw new Error('Lokal modell-bryggan saknar ett one-shot-API.')
  }

  // Custom (Hermes) provider?
  const custom = (await getCustomProviders()).find((c) => c.id === cfg.provider)
  if (custom) {
    const res = await generateApiProviderResponse({ provider: 'hermes', apiKey: custom.apiKey || '', model: cfg.model || custom.model || '', baseUrl: custom.baseUrl, history, signal })
    return res.text
  }

  // Built-in provider.
  const providerId = (cfg.provider && cfg.provider in API_PROVIDERS ? cfg.provider : 'openai') as ApiProviderType
  const apiKey = (await getStored(`${providerId}ApiKey`)) || ''
  const baseUrl = providerId === 'hermes' ? (await getStored('hermesBaseUrl')) || undefined : undefined
  const model = cfg.model || (await getStored(`${providerId}Model`)) || API_PROVIDERS[providerId].defaultModels[0] || ''
  if (!apiKey && !API_PROVIDERS[providerId].apiKeyOptional) throw new Error(`Ingen API-nyckel inställd för ${API_PROVIDERS[providerId].label}. Konfigurera den i AI-assistenten först.`)
  const res = await generateApiProviderResponse({ provider: providerId, apiKey, model, baseUrl, history, signal })
  return res.text
}
