// Mock the provider layer so we test the RESOLVER (source/model selection + key lookup), not the network.
jest.mock('../services/ai/apiProviders', () => ({
  API_PROVIDERS: {
    openai: { id: 'openai', label: 'OpenAI', defaultModels: ['gpt-4o-mini'], apiKeyOptional: false },
    anthropic: { id: 'anthropic', label: 'Anthropic', defaultModels: ['claude-x'], apiKeyOptional: false },
    hermes: { id: 'hermes', label: 'Hermes', defaultModels: [], apiKeyOptional: true, configurableEndpoint: true },
  },
  generateApiProviderResponse: jest.fn(async (p: any) => ({ text: `ran:${p.provider}:${p.model}:${p.apiKey ? 'key' : 'nokey'}:${p.baseUrl || '-'}`, totalTokens: 1 })),
}))

import { listAiOptions, runFeatureCompletion } from '../services/ai/featureCompletion'
import { generateApiProviderResponse } from '../services/ai/apiProviders'

beforeEach(() => {
  localStorage.clear()
  ;(generateApiProviderResponse as jest.Mock).mockClear()
  delete (window as any).mlc
})

describe('listAiOptions', () => {
  it('lists only providers the user configured (a key present), plus apiKeyOptional ones', async () => {
    localStorage.setItem('openaiApiKey', 'sk-test')
    localStorage.setItem('openaiModel', 'gpt-4o')
    const opts = await listAiOptions()
    const openai = opts.find((o) => o.id === 'openai')
    expect(openai).toMatchObject({ source: 'api', model: 'gpt-4o' })
    // anthropic has no key → excluded; hermes is apiKeyOptional → included even without a key.
    expect(opts.find((o) => o.id === 'anthropic')).toBeUndefined()
    expect(opts.find((o) => o.id === 'hermes')).toBeTruthy()
  })

  it('includes custom (Hermes) providers from storage', async () => {
    localStorage.setItem('aiCustomProviders', JSON.stringify([{ id: 'custom_a', label: 'My LAN', baseUrl: 'http://x', model: 'm', apiKey: 'k' }]))
    const opts = await listAiOptions()
    expect(opts.find((o) => o.id === 'custom_a')).toMatchObject({ source: 'hermes', label: 'My LAN' })
  })
})

describe('runFeatureCompletion', () => {
  it('resolves a built-in provider key + model and calls the provider', async () => {
    localStorage.setItem('openaiApiKey', 'sk-test')
    const out = await runFeatureCompletion({ source: 'api', provider: 'openai', model: 'gpt-4o' }, 'sys', 'prompt')
    expect(out).toBe('ran:openai:gpt-4o:key:-')
    const call = (generateApiProviderResponse as jest.Mock).mock.calls[0][0]
    expect(call.history).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'prompt' }])
  })

  it('routes a custom provider through hermes with its own baseUrl/key', async () => {
    localStorage.setItem('aiCustomProviders', JSON.stringify([{ id: 'custom_a', baseUrl: 'http://lan:1234', model: 'm', apiKey: 'k' }]))
    const out = await runFeatureCompletion({ source: 'hermes', provider: 'custom_a', model: 'm' }, 's', 'p')
    expect(out).toBe('ran:hermes:m:key:http://lan:1234')
  })

  it('throws a readable error when the chosen provider has no key', async () => {
    await expect(runFeatureCompletion({ source: 'api', provider: 'openai', model: 'x' }, 's', 'p')).rejects.toThrow(/API-nyckel/)
  })

  it('local source errors clearly when no on-device bridge is present', async () => {
    await expect(runFeatureCompletion({ source: 'local', model: 'phi' }, 's', 'p')).rejects.toThrow(/Lokal/)
  })

  it('falls back to openai when the provider id is unknown', async () => {
    localStorage.setItem('openaiApiKey', 'sk-test')
    const out = await runFeatureCompletion({ source: 'api', provider: 'bogus', model: 'gpt-4o' }, 's', 'p')
    expect(out).toContain('ran:openai:')
  })
})
