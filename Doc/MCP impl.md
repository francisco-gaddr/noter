# MCP Integration — Full Implementation Guide
## Next.js/Electron + React Native/Expo

**Status:** Agent implementation checklist — work through Phase by Phase, top to bottom.
**Assumption:** Both apps (Electron & React native Expo)have a working AI chat with basic (non-MCP) tool calls already in place.


Denna implementering ska göras för 2 appar , en React Native Expo-app och en Next.js Electron-app. Följ dessa  specifika instruktioner för detta och rekommendera bibliotek eller SDK's att använda. Följ  noga steg efter steg för att implementera allt till fullo för alla MCP-tjänster. Fyll i de saker som saknas. Gör även sökningar online för att säkerställa korrekt implementering.  Utgå från att det redan finns en grundläggande AI-chatt på plats med enklare tool calls (Ej MCP-relaterade än då detta inte implementerats än).

Man även kan fylla i nycklarna och app-infon i AI-inställningarna för MCP-sektionens inställningar där man väljer vilka MCP-applikationer som ska vara aktiva. De ska ändå lagras krypterat på enheten men kan hanteras inne i AI-inställningarna.  Om man fyller i nycklar och MCP-konfigurering i AI-inställningarna ska dessa overridea det som är inmatat i env-filen. Har bara värden angetts i .env-filen så ska detta gälla, om man har angett i AI-inställnignarna ska  dessa overridea env-värdena. Online-sök även igenom dokumentation för alla de tjäsnterna för korrekt MCP-implementering för alla dessa.


---

## Repository Status (Implemented in this codebase)

- Delad MCP-konfigmodell och resolver finns nu i `packages/shared/src/mcpSettings.ts`.
- Prioritetsordning är implementerad som: `AI-inställningar (krypterat lokalt)` > `.env` > default.
- Web/Electron AI-inställningar innehåller en MCP-sektion med aktivering per integration och redigering av nycklar/appinfo.
- Mobile AI-inställningar innehåller samma MCP-sektion med krypterad lagring via SecureStore.
- UI-värden sparas krypterat (`encrypt(...)`) och normaliseras defensivt vid läsning (`normalizeMcpUiSettings(...)`).
- Backend har MCP-runtime med stdio-processhantering, session-cache per användare+tjänst, timeout, retry, failure-cooldown och idle cleanup.
- Backend exponerar säkrade MCP-endpoints: `POST /api/mcp/tools`, `POST /api/mcp/call`, `GET /api/mcp/health` och `GET /api/mcp/dashboard`.
- AI tool-use i både web och mobile har stöd för `mcp_list_tools` och `mcp_call_tool`.
- Promptregler i båda apparna styr tjänsterouting: extern tjänst kräver explicit nämning, annars används lokala Noter-tools.
- Både web, mobile och backend har tester för override-logik, prompt/tooling och MCP-routes/runtime.
- Runtime validerar tool-anrop mot policy-allowlist per integration och aktuell verktygslista från MCP-servern.
- Metadata-audit loggas i runtime utan credentials och exponeras användarscope:at via dedikerad dashboard-respons.
- Runtime har skydd mot resource-abuse via rate-limit per användare+tjänst samt max sessions per användare/globalt.
- Runtime sanerar tool-args rekursivt (djup, storlek, nyckelfilter) för att blockera farliga payloads.
- Klienterna validerar säker transport för MCP-anrop och blockerar osäker HTTP utanför localhost.
- MCP-audit persisteras krypterat i backend med TTL-retention och visas endast via dedikerad MCP-säkerhetsdashboard.
- Krypterad auditpersistens stödjer nyckelrotation via key ring och versionsmarkerat payloadformat.
- MCP-säkerhetsdashboard är nåbar i både web/electron och mobilens AI-inställningar.

### Implementerade integrationer i settings

- Slack: `botToken`, `teamId`, `channelIds`
- Google Workspace: `clientId`, `clientSecret`, `redirectUri`, `oauthPath`
- Notion: `apiToken`, `workspaceId`
- Filesystem: `allowedPaths`
- Playwright: `browser`, `headless`, `channel`

### Env-variabler (fallback om UI saknar värde)

- Slack: `MCP_SLACK_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `MCP_SLACK_TEAM_ID`, `SLACK_TEAM_ID`, `MCP_SLACK_CHANNEL_IDS`, `SLACK_CHANNEL_IDS`
- Google Workspace: `MCP_GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `MCP_GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MCP_GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_OAUTH_REDIRECT_URI`, `MCP_GOOGLE_OAUTH_PATH`, `GOOGLE_OAUTH_PATH`
- Notion: `MCP_NOTION_API_TOKEN`, `NOTION_API_TOKEN`, `MCP_NOTION_WORKSPACE_ID`, `NOTION_WORKSPACE_ID`
- Filesystem: `MCP_FILESYSTEM_ALLOWED_PATHS`, `FILESYSTEM_ALLOWED_PATHS`
- Playwright: `MCP_PLAYWRIGHT_BROWSER`, `PLAYWRIGHT_BROWSER`, `MCP_PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_HEADLESS`, `MCP_PLAYWRIGHT_CHANNEL`, `PLAYWRIGHT_CHANNEL`

### Säkerhetskrav för agent-implementation

- Logga aldrig råa nycklar eller tokens i klient, backend eller testutskrifter.
- Spara endast krypterad settings-payload lokalt per användarscope.
- Vid parse-fel på sparad payload ska appen falla tillbaka till tom/säker konfiguration.
- Kör allowlist-validering av integration-id och fältnamn innan config används för server-processspawn.
- Begränsa filesystem-server till explicit allowlist av kataloger.
- Kör Playwright/Filesystem MCP endast i miljöer där Node-subprocesser är tillåtna (backend/electron-main).
- Validera `toolName` med strikt allowlist-pattern och begränsa storlek på `args` innan `tools/call`.
- Kräv explicit tjänsteintention i användartext för externa system (Notion/Google/Slack etc) innan MCP-anrop.
- Validera obligatoriska credentials per integration innan runtime tillåter aktivering.
- Begränsa payload-storlek för MCP-settings och stoppa överstora request-bodies.
- Säkerställ TLS i transit för alla externa miljöer; HTTP tillåts endast för localhost/dev.

### Prompt- och routingpolicy (nu implementerad)

- Lokala dataoperationer i Noter är alltid förstahandsval.
- Notion-MCP får endast användas när användaren explicit nämner Notion.
- Google Workspace-MCP får endast användas när användaren explicit nämner Google/Gmail/Drive/Calendar.
- Slack-MCP får endast användas när användaren explicit nämner Slack.
- MCP-flöde ska vara: `mcp_list_tools(service)` följt av `mcp_call_tool(service, toolName, args)`.
- Om osäkerhet finns mellan lokal Noter-åtgärd och extern tjänst ska agenten välja lokal Noter-åtgärd.

### Dokumentation som ska följas vid vidare implementation

- MCP-specifikation: https://modelcontextprotocol.io/specification/2025-11-25
- Slack server: https://www.npmjs.com/package/@modelcontextprotocol/server-slack
- Google Workspace MCP: https://github.com/taylorwilsdon/google_workspace_mcp och https://pypi.org/project/workspace-mcp/
- Notion MCP (remote + local): https://developers.notion.com/docs/get-started-with-mcp och https://www.npmjs.com/package/@notionhq/notion-mcp-server
- Filesystem MCP: https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem
- Playwright MCP: https://www.npmjs.com/package/@playwright/mcp

### Nästa tekniska steg för full MCP runtime

- Lägg till operationella larm för blockeringsnivåer och timeout-trender per integration.
- Lägg till rollout-styrning via feature-flags per integration och per miljö.
- Lägg till explicit tool-allowlist via konfigfil i produktion för miljöspecifik policy.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  ELECTRON APP (Next.js)                                         │
│                                                                 │
│  ┌──────────────┐   IPC   ┌───────────────────────────────┐   │
│  │  Renderer    │ ──────► │  Main Process (Node.js)        │   │
│  │  (React UI)  │         │  MCPConfigService              │   │
│  └──────────────┘         │  credentials-store (keytar)    │   │
│                            │  mcp-generator                 │   │
│                            │  mcp-manager (spawn subprocs)  │   │
│                            └──────────┬────────────────────┘   │
│                                       │ stdio                   │
│                            MCP Servers (subprocess):            │
│                            - @modelcontextprotocol/server-slack │
│                            - workspace-mcp (uvx)                │
│                            - @notionhq/notion-mcp-server        │
│                            - @modelcontextprotocol/server-filesystem │
│                            - @playwright/mcp                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  REACT NATIVE EXPO APP                                          │
│                                                                 │
│  ┌──────────────┐  fetch  ┌───────────────────────────────┐   │
│  │  Chat UI     │ ──────► │  Backend API (Node.js server)  │   │
│  │  Settings UI │         │  /api/chat   — Anthropic SDK   │   │
│  │              │         │  /api/settings/mcp             │   │
│  └──────────────┘         │  MCP servers spawned here      │   │
│                            └───────────────────────────────┘   │
│                                                                 │
│  NOTE: React Native cannot spawn child processes.              │
│  ALL MCP servers run on the backend, not in the mobile app.    │
│  Mobile app stores credentials via expo-secure-store.          │
│  Credentials are sent to backend on save (encrypted in transit)│
└─────────────────────────────────────────────────────────────────┘
```

### Key architectural difference
| | Electron (Next.js) | React Native (Expo) |
|---|---|---|
| MCP subprocess spawn | Main process (Node.js) | Backend server only |
| Credential storage | `keytar` (OS keychain) | `expo-secure-store` |
| mcp.json | Written to disk | Not used — SDK injection only |
| Settings UI → backend | IPC bridge | REST API call |
| Browser (Playwright) | Supported | Not applicable — skip |
| Filesystem MCP | Supported (Windows paths) | Not applicable — skip |

---

## MCP Servers — Package Reference

| Integration | Package | Command | Auth |
|---|---|---|---|
| Slack | `@modelcontextprotocol/server-slack` | `npx -y` | Bot Token |
| Google Workspace | `workspace-mcp` (PyPI) | `uvx` | OAuth 2.0 client |
| Notion | `@notionhq/notion-mcp-server` | `npx -y` | Integration Token |
| Filesystem (Windows) | `@modelcontextprotocol/server-filesystem` | `npx -y` | Allowed paths (no auth) |
| Browser (Playwright) | `@playwright/mcp` | `npx -y` | None |

---

## Phase 0 — System Prerequisites

### [ ] 0.1 Node.js & npm
```bash
node --version   # must be >= 18
npm --version
```

### [ ] 0.2 Python + uv (required for workspace-mcp / Google services)
```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# Verify
uvx --version
uv python install 3.11
```

### [ ] 0.3 Playwright browser binaries (Electron only)
```bash
npx playwright install chromium
```

### [ ] 0.4 Native build tools (for keytar in Electron)
```bash
# macOS
xcode-select --install

# Linux
sudo apt-get install libsecret-1-dev

# Windows — nothing needed, Credential Manager is built-in
```

---

## Phase 1 — Shared Type & Schema Layer

Create this in a shared location used by both apps. In a monorepo place it under `packages/mcp-shared/`. In separate repos, copy the file to each.

### [ ] 1.1 Create `src/lib/mcp/types.ts`

```typescript
// src/lib/mcp/types.ts

export const MCP_INTEGRATION_IDS = [
  'slack',
  'gdrive',
  'gmail',
  'gcalendar',
  'notion',
  'filesystem',   // Electron only
  'browser',      // Electron only
] as const

export type MCPIntegrationId = typeof MCP_INTEGRATION_IDS[number]

// Per-integration credential shapes
export interface SlackCredentials {
  SLACK_BOT_TOKEN: string               // required — xoxb-...
  SLACK_TEAM_ID: string                 // required — T0XXXXXXX
  SLACK_CHANNEL_IDS?: string            // optional — comma-separated
  SLACK_MCP_ADD_MESSAGE_TOOL?: 'true' | 'false' // optional — default 'false'
}

export interface GoogleCredentials {
  GOOGLE_OAUTH_CLIENT_ID: string
  GOOGLE_OAUTH_CLIENT_SECRET: string
  GOOGLE_OAUTH_PATH?: string            // path to stored token JSON
}

export interface NotionCredentials {
  NOTION_TOKEN: string                  // ntn_... or secret_...
}

export interface FilesystemCredentials {
  ALLOWED_PATHS: string                 // semicolon-separated Windows paths
  // Example: "C:\\Users\\name\\Documents;C:\\Projects"
}

// Browser has no credentials — just enabled/disabled
export interface BrowserCredentials {}

export type IntegrationCredentialMap = {
  slack: SlackCredentials
  gdrive: GoogleCredentials
  gmail: GoogleCredentials
  gcalendar: GoogleCredentials
  notion: NotionCredentials
  filesystem: FilesystemCredentials
  browser: BrowserCredentials
}

export interface MCPIntegrationConfig<T extends MCPIntegrationId = MCPIntegrationId> {
  enabled: boolean
  credentials: Partial<IntegrationCredentialMap[T]>
}

export interface MCPUIConfig {
  integrations: {
    [K in MCPIntegrationId]?: MCPIntegrationConfig<K>
  }
}

// What gets returned to UI (secrets masked)
export type MCPUIConfigMasked = MCPUIConfig
```

---

## Phase 2 — Credential Storage

### ELECTRON: [ ] 2.1 Install keytar

```bash
# In Electron app root
npm install keytar
npm install --save-dev @types/node
```

### ELECTRON: [ ] 2.2 Create `src/lib/mcp/credentials-store.electron.ts`

```typescript
// src/lib/mcp/credentials-store.electron.ts
// Runs in Electron main process ONLY

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { MCPUIConfig } from './types'

const STORE_PATH = path.join(
  process.env.APPDATA || process.env.HOME || '.',
  '.ai-app',
  'mcp-credentials.enc'
)
const KEYTAR_SERVICE = 'ai-app-mcp'
const KEYTAR_ACCOUNT = 'master-key'

async function getMasterKey(): Promise<Buffer> {
  // Dynamic import — keytar is a native module, only available in main process
  const keytar = await import('keytar')
  let key = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  if (!key) {
    key = randomBytes(32).toString('hex')
    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, key)
  }
  return Buffer.from(key, 'hex')
}

export async function saveUICredentials(config: MCPUIConfig): Promise<void> {
  const key = await getMasterKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const json = JSON.stringify(config)
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, tag, enc])
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, payload.toString('base64'), 'utf8')
}

export async function loadUICredentials(): Promise<MCPUIConfig | null> {
  if (!fs.existsSync(STORE_PATH)) return null
  try {
    const key = await getMasterKey()
    const payload = Buffer.from(fs.readFileSync(STORE_PATH, 'utf8'), 'base64')
    const iv = payload.subarray(0, 16)
    const tag = payload.subarray(16, 32)
    const enc = payload.subarray(32)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return JSON.parse(dec.toString('utf8'))
  } catch {
    return null
  }
}
```

### EXPO: [ ] 2.3 Install expo-secure-store (mobile app)

```bash
# In Expo app root
npx expo install expo-secure-store
```

### EXPO: [ ] 2.4 Create `src/lib/mcp/credentials-store.expo.ts`

```typescript
// src/lib/mcp/credentials-store.expo.ts
// Runs in React Native / Expo only

import * as SecureStore from 'expo-secure-store'
import type { MCPUIConfig } from './types'

const STORE_KEY = 'mcp_ui_config'

export async function saveUICredentials(config: MCPUIConfig): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(config))
}

export async function loadUICredentials(): Promise<MCPUIConfig | null> {
  const raw = await SecureStore.getItemAsync(STORE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
```

### BACKEND (for Expo API): [ ] 2.5 Create `src/lib/mcp/credentials-store.server.ts`

The Expo backend server stores credentials the same way as Electron — using keytar (or AES-256-GCM with env fallback for dev).

```typescript
// src/lib/mcp/credentials-store.server.ts
// Node.js server — same encryption as Electron version but different path

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { MCPUIConfig } from './types'

const STORE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.ai-app',
  'mcp-credentials.enc'
)

async function getMasterKey(): Promise<Buffer> {
  try {
    const keytar = await import('keytar')
    let key = await keytar.getPassword('ai-app-mcp', 'master-key')
    if (!key) {
      key = randomBytes(32).toString('hex')
      await keytar.setPassword('ai-app-mcp', 'master-key', key)
    }
    return Buffer.from(key, 'hex')
  } catch {
    // Fallback for environments without keytar (CI, Docker)
    const envKey = process.env.MCP_MASTER_KEY
    if (!envKey) throw new Error('No secure storage available. Set MCP_MASTER_KEY env.')
    return scryptSync(envKey, 'ai-app-mcp-salt', 32)
  }
}

export async function saveUICredentials(config: MCPUIConfig): Promise<void> {
  const key = await getMasterKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, Buffer.concat([iv, tag, enc]).toString('base64'), 'utf8')
}

export async function loadUICredentials(): Promise<MCPUIConfig | null> {
  if (!fs.existsSync(STORE_PATH)) return null
  try {
    const key = await getMasterKey()
    const payload = Buffer.from(fs.readFileSync(STORE_PATH, 'utf8'), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 16))
    decipher.setAuthTag(payload.subarray(16, 32))
    return JSON.parse(Buffer.concat([decipher.update(payload.subarray(32)), decipher.final()]).toString('utf8'))
  } catch {
    return null
  }
}
```

---

## Phase 3 — Config Resolver (env + UI merge)

**Both apps use the same resolver logic on the server/main-process side.**

### [ ] 3.1 Create `src/lib/mcp/config-resolver.ts`

```typescript
// src/lib/mcp/config-resolver.ts
// Priority: UI credentials (1) > .env values (2) > not configured (skip server)

import { loadUICredentials } from './credentials-store.server'  // or .electron variant
import type {
  MCPUIConfig,
  SlackCredentials,
  GoogleCredentials,
  NotionCredentials,
  FilesystemCredentials,
} from './types'

function env(key: string): string | null {
  const v = process.env[key]
  return v && v.trim() ? v.trim() : null
}

// UI value overrides env. Both are nullable. Returns non-empty string or null.
function resolve(uiVal: string | undefined, envKey: string): string | null {
  if (uiVal && uiVal.trim()) return uiVal.trim()
  return env(envKey)
}

export interface ResolvedMCPConfig {
  slack?: { enabled: boolean; credentials: SlackCredentials }
  gdrive?: { enabled: boolean; credentials: GoogleCredentials }
  gmail?: { enabled: boolean; credentials: GoogleCredentials }
  gcalendar?: { enabled: boolean; credentials: GoogleCredentials }
  notion?: { enabled: boolean; credentials: NotionCredentials }
  filesystem?: { enabled: boolean; credentials: FilesystemCredentials }
  browser?: { enabled: boolean; credentials: {} }
}

export async function resolveAllCredentials(): Promise<ResolvedMCPConfig> {
  const ui: MCPUIConfig = (await loadUICredentials()) ?? { integrations: {} }
  const i = ui.integrations
  const result: ResolvedMCPConfig = {}

  // ── SLACK ──────────────────────────────────────────────────────────
  const slackToken = resolve(i.slack?.credentials?.SLACK_BOT_TOKEN, 'SLACK_BOT_TOKEN')
  const slackTeam  = resolve(i.slack?.credentials?.SLACK_TEAM_ID,   'SLACK_TEAM_ID')
  if (slackToken && slackTeam) {
    result.slack = {
      enabled: i.slack?.enabled ?? true,
      credentials: {
        SLACK_BOT_TOKEN: slackToken,
        SLACK_TEAM_ID:   slackTeam,
        SLACK_CHANNEL_IDS: resolve(i.slack?.credentials?.SLACK_CHANNEL_IDS, 'SLACK_CHANNEL_IDS') ?? undefined,
        SLACK_MCP_ADD_MESSAGE_TOOL: (i.slack?.credentials?.SLACK_MCP_ADD_MESSAGE_TOOL ?? env('SLACK_MCP_ADD_MESSAGE_TOOL') ?? 'false') as 'true' | 'false',
      }
    }
  }

  // ── GOOGLE WORKSPACE ───────────────────────────────────────────────
  // Drive, Gmail, Calendar share ONE OAuth app — same client_id + secret
  // UI config: check gdrive first, fall back to gmail, then gcalendar for the shared creds
  const gClientId = resolve(
    i.gdrive?.credentials?.GOOGLE_OAUTH_CLIENT_ID ??
    i.gmail?.credentials?.GOOGLE_OAUTH_CLIENT_ID ??
    i.gcalendar?.credentials?.GOOGLE_OAUTH_CLIENT_ID,
    'GOOGLE_OAUTH_CLIENT_ID'
  )
  const gSecret = resolve(
    i.gdrive?.credentials?.GOOGLE_OAUTH_CLIENT_SECRET ??
    i.gmail?.credentials?.GOOGLE_OAUTH_CLIENT_SECRET ??
    i.gcalendar?.credentials?.GOOGLE_OAUTH_CLIENT_SECRET,
    'GOOGLE_OAUTH_CLIENT_SECRET'
  )
  const gOAuthPath = resolve(
    i.gdrive?.credentials?.GOOGLE_OAUTH_PATH,
    'GOOGLE_OAUTH_PATH'
  ) ?? `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.ai-app/google-credentials.json`

  if (gClientId && gSecret) {
    const googleCreds: GoogleCredentials = {
      GOOGLE_OAUTH_CLIENT_ID: gClientId,
      GOOGLE_OAUTH_CLIENT_SECRET: gSecret,
      GOOGLE_OAUTH_PATH: gOAuthPath,
    }
    if (i.gdrive?.enabled    ?? (env('GDRIVE_ENABLED')  !== 'false'))  result.gdrive    = { enabled: true, credentials: googleCreds }
    if (i.gmail?.enabled     ?? (env('GMAIL_ENABLED')   !== 'false'))  result.gmail     = { enabled: true, credentials: googleCreds }
    if (i.gcalendar?.enabled ?? (env('GCAL_ENABLED')    !== 'false'))  result.gcalendar = { enabled: true, credentials: googleCreds }
  }

  // ── NOTION ─────────────────────────────────────────────────────────
  const notionToken = resolve(i.notion?.credentials?.NOTION_TOKEN, 'NOTION_TOKEN')
  if (notionToken) {
    result.notion = {
      enabled: i.notion?.enabled ?? true,
      credentials: { NOTION_TOKEN: notionToken }
    }
  }

  // ── FILESYSTEM (Electron/Windows only) ────────────────────────────
  const fsPaths = resolve(i.filesystem?.credentials?.ALLOWED_PATHS, 'MCP_FILESYSTEM_PATHS')
  if (fsPaths) {
    result.filesystem = {
      enabled: i.filesystem?.enabled ?? true,
      credentials: { ALLOWED_PATHS: fsPaths }
    }
  }

  // ── BROWSER (Electron only) ────────────────────────────────────────
  const browserEnabled = i.browser?.enabled ?? (env('MCP_BROWSER_ENABLED') === 'true')
  if (browserEnabled) {
    result.browser = { enabled: true, credentials: {} }
  }

  return result
}
```

---

## Phase 4 — mcp.json Generator + SDK Builder

### [ ] 4.1 Create `src/lib/mcp/mcp-generator.ts`

```typescript
// src/lib/mcp/mcp-generator.ts
// Writes mcp.json to disk. Used by Electron main process.
// React Native backend uses buildMCPServerConfigs() directly (no disk write needed).

import fs from 'fs'
import path from 'path'
import { resolveAllCredentials } from './config-resolver'

export async function generateMCPJson(outputPath?: string): Promise<void> {
  const resolved = await resolveAllCredentials()
  const servers: Record<string, unknown> = {}

  buildSlackBlock(resolved, servers)
  buildGoogleWorkspaceBlock(resolved, servers)
  buildNotionBlock(resolved, servers)
  buildFilesystemBlock(resolved, servers)    // Electron only — no-op if ALLOWED_PATHS not set
  buildBrowserBlock(resolved, servers)       // Electron only — no-op if not enabled

  const dest = outputPath ?? path.resolve(process.cwd(), 'mcp.json')
  fs.writeFileSync(dest, JSON.stringify({ mcpServers: servers }, null, 2), 'utf8')
  console.log('[MCP] mcp.json written:', Object.keys(servers))
}

// ── Exported for SDK direct injection (no disk I/O) ──────────────────────────
export async function buildMCPServerConfigs() {
  const resolved = await resolveAllCredentials()
  const servers: Record<string, unknown> = {}
  buildSlackBlock(resolved, servers)
  buildGoogleWorkspaceBlock(resolved, servers)
  buildNotionBlock(resolved, servers)
  buildFilesystemBlock(resolved, servers)
  buildBrowserBlock(resolved, servers)
  return servers
}

// ── Per-service block builders ────────────────────────────────────────────────

function buildSlackBlock(resolved: Awaited<ReturnType<typeof resolveAllCredentials>>, out: Record<string, unknown>) {
  if (!resolved.slack?.enabled) return
  const c = resolved.slack.credentials
  out['slack'] = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: {
      SLACK_BOT_TOKEN:  c.SLACK_BOT_TOKEN,
      SLACK_TEAM_ID:    c.SLACK_TEAM_ID,
      ...(c.SLACK_CHANNEL_IDS ? { SLACK_CHANNEL_IDS: c.SLACK_CHANNEL_IDS } : {}),
      ...(c.SLACK_MCP_ADD_MESSAGE_TOOL === 'true' ? { SLACK_MCP_ADD_MESSAGE_TOOL: 'true' } : {}),
    }
  }
}

function buildGoogleWorkspaceBlock(resolved: Awaited<ReturnType<typeof resolveAllCredentials>>, out: Record<string, unknown>) {
  const tools: string[] = []
  if (resolved.gdrive?.enabled)    tools.push('drive')
  if (resolved.gmail?.enabled)     tools.push('gmail')
  if (resolved.gcalendar?.enabled) tools.push('calendar')
  if (tools.length === 0) return

  const c = (resolved.gdrive ?? resolved.gmail ?? resolved.gcalendar)!.credentials
  out['google_workspace'] = {
    command: 'uvx',
    args: ['workspace-mcp', '--tools', ...tools],
    env: {
      GOOGLE_OAUTH_CLIENT_ID:     c.GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET: c.GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_PATH:          c.GOOGLE_OAUTH_PATH,
      ...(process.env.NODE_ENV === 'development' ? { OAUTHLIB_INSECURE_TRANSPORT: '1' } : {}),
    }
  }
}

function buildNotionBlock(resolved: Awaited<ReturnType<typeof resolveAllCredentials>>, out: Record<string, unknown>) {
  if (!resolved.notion?.enabled) return
  const c = resolved.notion.credentials
  out['notion'] = {
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: {
      // Official package accepts NOTION_TOKEN directly
      OPENAPI_MCP_HEADERS: JSON.stringify({
        Authorization: `Bearer ${c.NOTION_TOKEN}`,
        'Notion-Version': '2025-09-03',
      })
    }
  }
}

function buildFilesystemBlock(resolved: Awaited<ReturnType<typeof resolveAllCredentials>>, out: Record<string, unknown>) {
  if (!resolved.filesystem?.enabled) return
  const paths = resolved.filesystem.credentials.ALLOWED_PATHS
    .split(';')
    .map(p => p.trim())
    .filter(Boolean)
  if (paths.length === 0) return

  out['filesystem'] = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', ...paths],
    // Note: Windows paths with spaces must be quoted by the spawn shell.
    // The Anthropic SDK handles this correctly when spawning via stdio.
  }
}

function buildBrowserBlock(resolved: Awaited<ReturnType<typeof resolveAllCredentials>>, out: Record<string, unknown>) {
  if (!resolved.browser?.enabled) return
  out['browser'] = {
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest', '--browser', 'chromium'],
  }
}
```

---

## Phase 5 — Anthropic SDK Integration (Chat API Route)

### [ ] 5.1 ELECTRON: Chat handler in main process IPC

```typescript
// src/main/chat-handler.ts (Electron main process)
import Anthropic from '@anthropic-ai/sdk'
import { buildMCPServerConfigs, generateMCPJson } from '../lib/mcp/mcp-generator'
import { ipcMain } from 'electron'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

ipcMain.handle('chat:send', async (_event, messages: Anthropic.MessageParam[]) => {
  // Keep mcp.json in sync for external tooling
  await generateMCPJson()

  const mcpConfigs = await buildMCPServerConfigs()
  const mcpServers = Object.entries(mcpConfigs).map(([name, cfg]: [string, any]) => ({
    type: 'stdio' as const,
    name,
    command: cfg.command,
    args:    cfg.args ?? [],
    env:     cfg.env  ?? {},
  }))

  const response = await client.beta.messages.create({
    model:       'claude-opus-4-5',
    max_tokens:  4096,
    system:      buildSystemPrompt(mcpServers.map(s => s.name)),
    messages,
    mcp_servers: mcpServers,
    betas:       ['mcp-client-2025-04-04'],
  })

  return response
})

function buildSystemPrompt(activeServers: string[]): string {
  const tools = activeServers.map(s => SERVER_TOOL_SUMMARIES[s] ?? s).join('\n')
  return `You are an AI assistant with access to the following integrations:\n${tools}\nUse them proactively when relevant.`
}

const SERVER_TOOL_SUMMARIES: Record<string, string> = {
  slack:             '- Slack: list channels, read history, post messages, manage reactions',
  google_workspace:  '- Google Drive: search/read files\n- Gmail: search/read/send email\n- Google Calendar: list/create/update/delete events',
  notion:            '- Notion: search pages, read/create/update pages and databases',
  filesystem:        '- Filesystem: read/write/search files on Windows filesystem',
  browser:           '- Browser: navigate URLs, click, fill forms, take screenshots',
}
```

### [ ] 5.2 EXPO BACKEND: Chat API route (Next.js API or Express)

```typescript
// src/app/api/chat/route.ts   (Next.js App Router — also works as Express route)
import Anthropic from '@anthropic-ai/sdk'
import { buildMCPServerConfigs } from '@/lib/mcp/mcp-generator'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { messages } = await req.json()

  const mcpConfigs = await buildMCPServerConfigs()
  const mcpServers = Object.entries(mcpConfigs).map(([name, cfg]: [string, any]) => ({
    type: 'stdio' as const,
    name,
    command: cfg.command,
    args:    cfg.args ?? [],
    env:     cfg.env  ?? {},
  }))

  const response = await client.beta.messages.create({
    model:       'claude-opus-4-5',
    max_tokens:  4096,
    messages,
    mcp_servers: mcpServers,
    betas:       ['mcp-client-2025-04-04'],
  })

  return NextResponse.json(response)
}
```

### [ ] 5.3 EXPO BACKEND: Settings API routes

```typescript
// src/app/api/settings/mcp/route.ts

import { loadUICredentials, saveUICredentials } from '@/lib/mcp/credentials-store.server'
import { generateMCPJson } from '@/lib/mcp/mcp-generator'
import { NextRequest, NextResponse } from 'next/server'

const SECRET_FIELDS = ['TOKEN', 'SECRET', 'PASSWORD', 'KEY']
const isSecret = (f: string) => SECRET_FIELDS.some(s => f.toUpperCase().includes(s))

function maskConfig(config: any): any {
  const masked = JSON.parse(JSON.stringify(config))
  for (const key of Object.keys(masked.integrations ?? {})) {
    const creds = masked.integrations[key]?.credentials ?? {}
    for (const field of Object.keys(creds)) {
      if (isSecret(field) && typeof creds[field] === 'string' && creds[field].length > 4) {
        creds[field] = '••••••••' + creds[field].slice(-4)
      }
    }
  }
  return masked
}

export async function GET() {
  const config = await loadUICredentials()
  return NextResponse.json(config ? maskConfig(config) : { integrations: {} })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  await saveUICredentials(body)
  await generateMCPJson()
  return NextResponse.json({ ok: true })
}
```

---

## Phase 6 — Electron IPC Bridge for Settings

### [ ] 6.1 Expose settings API from main process to renderer

```typescript
// src/main/preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mcpAPI', {
  getSettings: () => ipcRenderer.invoke('mcp:getSettings'),
  saveSettings: (config: unknown) => ipcRenderer.invoke('mcp:saveSettings', config),
})
```

```typescript
// src/main/mcp-ipc.ts
import { ipcMain } from 'electron'
import { loadUICredentials, saveUICredentials } from '../lib/mcp/credentials-store.electron'
import { generateMCPJson } from '../lib/mcp/mcp-generator'

const SECRET_FIELDS = ['TOKEN', 'SECRET', 'PASSWORD', 'KEY']
const isSecret = (f: string) => SECRET_FIELDS.some(s => f.toUpperCase().includes(s))

ipcMain.handle('mcp:getSettings', async () => {
  const config = await loadUICredentials()
  if (!config) return { integrations: {} }
  const masked = JSON.parse(JSON.stringify(config))
  for (const key of Object.keys(masked.integrations ?? {})) {
    const creds = masked.integrations[key]?.credentials ?? {}
    for (const field of Object.keys(creds)) {
      if (isSecret(field) && typeof creds[field] === 'string' && creds[field].length > 4) {
        creds[field] = '••••••••' + creds[field].slice(-4)
      }
    }
  }
  return masked
})

ipcMain.handle('mcp:saveSettings', async (_event, config) => {
  await saveUICredentials(config)
  await generateMCPJson()
  return { ok: true }
})
```

### [ ] 6.2 Register IPC handlers in main `main.ts`

```typescript
// In src/main/main.ts (or index.ts — wherever Electron main process starts)
import './mcp-ipc'   // registers all ipcMain.handle calls
import './chat-handler'
```

---

## Phase 7 — Settings UI Components

### [ ] 7.1 ELECTRON/EXPO shared: `MCPSettingsPanel.tsx`

```typescript
// src/components/settings/MCPSettingsPanel.tsx
// Works in both React (Electron renderer) and React Native (Expo)
// The only difference is the API call — abstract it via a prop

'use client'
import React, { useState, useEffect } from 'react'

interface MCPSettingsPanelProps {
  getSettings: () => Promise<any>
  saveSettings: (config: any) => Promise<any>
  platform: 'electron' | 'expo'
}

// Field definitions per integration — used to render form dynamically
const INTEGRATION_FIELDS: Record<string, {
  label: string
  key: string
  placeholder: string
  secret: boolean
  required: boolean
  hint?: string
}[]> = {
  slack: [
    { key: 'SLACK_BOT_TOKEN',             label: 'Bot Token',        placeholder: 'xoxb-...',          secret: true,  required: true,  hint: 'OAuth Bot Token från Slack App' },
    { key: 'SLACK_TEAM_ID',               label: 'Team / Workspace ID', placeholder: 'T0XXXXXXX',       secret: false, required: true,  hint: 'Börjar med T — visas i workspace-URL' },
    { key: 'SLACK_CHANNEL_IDS',           label: 'Channel IDs',      placeholder: 'C01234,C56789',     secret: false, required: false, hint: 'Valfritt: begränsa till specifika kanaler' },
    { key: 'SLACK_MCP_ADD_MESSAGE_TOOL',  label: 'Tillåt posting',   placeholder: 'true / false',      secret: false, required: false, hint: 'Sätt true för att aktivera send-message' },
  ],
  // Google Drive, Gmail, Calendar share the same OAuth fields
  // Show them grouped under a "Google" section with individual toggles
  gdrive: [
    { key: 'GOOGLE_OAUTH_CLIENT_ID',     label: 'Client ID',     placeholder: '*.apps.googleusercontent.com', secret: false, required: true },
    { key: 'GOOGLE_OAUTH_CLIENT_SECRET', label: 'Client Secret', placeholder: 'GOCSPX-...',                  secret: true,  required: true },
    { key: 'GOOGLE_OAUTH_PATH',          label: 'Token sökväg',  placeholder: '/home/user/.ai-app/goog.json',secret: false, required: false, hint: 'Lämna tomt för standard ~/.ai-app/' },
  ],
  notion: [
    { key: 'NOTION_TOKEN', label: 'Integration Token', placeholder: 'ntn_... or secret_...', secret: true, required: true, hint: 'notion.so/profile/integrations' },
  ],
  filesystem: [
    { key: 'ALLOWED_PATHS', label: 'Tillåtna sökvägar', placeholder: 'C:\\Users\\namn\\Docs;C:\\Projekt', secret: false, required: true, hint: 'Separera med semikolon (;)' },
  ],
  // browser has no credentials
}

export function MCPSettingsPanel({ getSettings, saveSettings, platform }: MCPSettingsPanelProps) {
  const [config, setConfig] = useState<any>({ integrations: {} })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    getSettings().then(setConfig)
  }, [])

  const setEnabled = (id: string, enabled: boolean) => {
    setConfig((prev: any) => ({
      ...prev,
      integrations: {
        ...prev.integrations,
        [id]: { ...prev.integrations?.[id], enabled }
      }
    }))
    setDirty(true)
  }

  const setField = (id: string, field: string, value: string) => {
    setConfig((prev: any) => ({
      ...prev,
      integrations: {
        ...prev.integrations,
        [id]: {
          ...prev.integrations?.[id],
          credentials: {
            ...prev.integrations?.[id]?.credentials,
            [field]: value
          }
        }
      }
    }))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await saveSettings(config)
      setStatus('Sparad och mcp.json uppdaterad.')
      setDirty(false)
    } catch (e: any) {
      setStatus(`Fel: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Render: loop over INTEGRATION_FIELDS, render toggle + form fields
  // For gdrive/gmail/gcalendar: show shared Google fields once, three toggles
  // For browser: only a toggle, no fields
  // Styling: use your own design system (Tailwind / NativeWind / etc.)

  // NOTE TO AGENT: Implement the JSX here using your app's existing component library.
  // The logic above is complete. The render section is intentionally left as pseudocode
  // so the agent can match the existing UI style of the app.

  return (
    <div>
      {/* Render each integration using setEnabled / setField */}
      {/* Save button: onClick={save}, disabled={!dirty || saving} */}
      {/* Status message: show {status} */}
    </div>
  )
}
```

### [ ] 7.2 ELECTRON: Wire panel to IPC

```typescript
// src/renderer/pages/Settings.tsx
import { MCPSettingsPanel } from '@/components/settings/MCPSettingsPanel'

export default function SettingsPage() {
  return (
    <MCPSettingsPanel
      platform="electron"
      getSettings={() => window.mcpAPI.getSettings()}
      saveSettings={(c) => window.mcpAPI.saveSettings(c)}
    />
  )
}
```

### [ ] 7.3 EXPO: Wire panel to backend API

```typescript
// src/screens/SettingsScreen.tsx
import { MCPSettingsPanel } from '@/components/settings/MCPSettingsPanel'

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

export default function SettingsScreen() {
  return (
    <MCPSettingsPanel
      platform="expo"
      getSettings={() => fetch(`${API_BASE}/api/settings/mcp`).then(r => r.json())}
      saveSettings={(c) => fetch(`${API_BASE}/api/settings/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c)
      }).then(r => r.json())}
    />
  )
}
```

---

## Phase 8 — Environment Variables Reference

### [ ] 8.1 `.env.local` (complete reference)

```bash
# ── Anthropic ──────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── Slack ──────────────────────────────────────────────────────────
SLACK_BOT_TOKEN=xoxb-...
SLACK_TEAM_ID=T01234567
SLACK_CHANNEL_IDS=                        # optional
SLACK_MCP_ADD_MESSAGE_TOOL=false          # true to enable posting

# ── Google Workspace ───────────────────────────────────────────────
GOOGLE_OAUTH_CLIENT_ID=123.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_PATH=                        # default: ~/.ai-app/google-credentials.json

GDRIVE_ENABLED=true
GMAIL_ENABLED=true
GCAL_ENABLED=true

# ── Notion ─────────────────────────────────────────────────────────
NOTION_TOKEN=ntn_...

# ── Filesystem (Electron / Windows only) ──────────────────────────
MCP_FILESYSTEM_PATHS=C:\Users\name\Documents;C:\Projects

# ── Browser (Electron only) ────────────────────────────────────────
MCP_BROWSER_ENABLED=false                 # false by default — opt-in

# ── Security (dev fallback if keytar unavailable) ──────────────────
# MCP_MASTER_KEY=                         # ONLY for dev/CI without OS keychain
```

---

## Phase 9 — External Service Setup (one-time per service)

### [ ] 9.1 Slack App

1. Go to `https://api.slack.com/apps` → Create New App → From scratch
2. **OAuth & Permissions** → Bot Token Scopes — add all:
   - `channels:read`, `channels:history`
   - `groups:read`, `groups:history`
   - `im:read`, `im:history`
   - `mpim:read`, `mpim:history`
   - `users:read`, `search:read`
   - `chat:write` ← only if SLACK_MCP_ADD_MESSAGE_TOOL=true
3. **Install to Workspace** → copy **Bot User OAuth Token** (`xoxb-...`)
4. Team ID: visible in browser URL (`/client/T0XXXXXXX`) or call `https://slack.com/api/auth.test?token=YOUR_TOKEN`

### [ ] 9.2 Google Cloud OAuth App (covers Drive + Gmail + Calendar)

1. `https://console.cloud.google.com` → Create or select project
2. **APIs & Services** → Library → Enable:
   - Google Drive API
   - Gmail API
   - Google Calendar API
3. **Credentials** → Create Credentials → OAuth 2.0 Client ID → **Desktop app**
4. Download JSON. Extract `client_id` and `client_secret`
5. **OAuth consent screen** → External → add your email as test user
6. Scopes needed (workspace-mcp requests them automatically during OAuth flow):
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar`
7. **First run** — browser OAuth flow is triggered automatically by workspace-mcp on first use. Token saved to `GOOGLE_OAUTH_PATH`.

### [ ] 9.3 Notion Integration

1. `https://www.notion.so/profile/integrations` → New integration
2. Name it, associate with your workspace
3. **Capabilities** tab: set Read/Update/Insert as needed
4. Copy **Internal Integration Token** (`ntn_...`)
5. For each Notion page/database the AI should access: open the page → `···` → **Connect to integration** → select your integration

### [ ] 9.4 Filesystem (Windows — Electron only)

No external setup. Just configure `ALLOWED_PATHS` or via UI. Paths must exist on disk.

```
# Example paths
C:\Users\name\Documents
C:\Projects
C:\Users\name\Desktop
```

**Windows path gotcha:** The official `@modelcontextprotocol/server-filesystem` had issues with spaces in paths on Windows (PR #543, merged Aug 2025). If you hit this, quote paths or use the 8.3 short name format. Verify with the latest npm version.

### [ ] 9.5 Browser / Playwright (Electron only)

No external setup. Playwright downloads Chromium automatically on first use.

```bash
# Manually pre-install to avoid first-run delay:
npx playwright install chromium
```

---

## Phase 10 — Tool Use Reference

### Slack — `@modelcontextprotocol/server-slack`

| Tool | Description |
|---|---|
| `slack_list_channels` | List channels. Returns ID, name, type |
| `slack_post_message` | Send message to channel. Requires SLACK_MCP_ADD_MESSAGE_TOOL=true |
| `slack_reply_to_thread` | Reply in thread via thread_ts |
| `slack_add_reaction` | Add emoji reaction to message |
| `slack_get_channel_history` | Paginated message history for channel |
| `slack_get_thread_replies` | All replies in a thread |
| `slack_get_users` | List all workspace users |
| `slack_get_user_profile` | User profile including custom fields |

### Google Drive — `workspace-mcp` (tool: drive)

| Tool | Description |
|---|---|
| `search_drive` | Full-text or metadata search |
| `get_drive_file` | Read file content by ID. Exports Docs/Sheets/Slides |
| `list_drive_files` | List files in folder, paginated |
| `create_drive_folder` | Create new folder |

### Gmail — `workspace-mcp` (tool: gmail)

| Tool | Description |
|---|---|
| `search_emails` | Gmail query syntax (from:, to:, subject:, has:attachment, etc.) |
| `get_email` | Full email content and attachments |
| `send_email` | Send email with To, CC, BCC, HTML or text body |
| `create_draft` | Create email draft |
| `list_labels` | List all Gmail labels |
| `modify_email` | Apply/remove labels, mark read/unread, archive |
| `trash_email` | Move to trash |

### Google Calendar — `workspace-mcp` (tool: calendar)

| Tool | Description |
|---|---|
| `list_calendars` | All calendars on the account |
| `list_events` | Events in time range, filterable by calendar |
| `get_event` | Full event details |
| `create_event` | New event with timezone, Meet link, attendees, reminders |
| `update_event` | Update existing event |
| `delete_event` | Delete event |

### Notion — `@notionhq/notion-mcp-server`

| Tool | Description |
|---|---|
| `search` | Search pages and databases by title |
| `retrieve-a-page` | Get full page content |
| `retrieve-block-children` | Get blocks/content inside a page |
| `append-block-children` | Append blocks to a page |
| `create-a-page` | Create new page in parent |
| `update-page` | Update page properties |
| `query-a-database` | Query a database with filters and sorts |
| `retrieve-a-database` | Database schema and metadata |
| `create-a-database` | Create new database |
| `retrieve-a-data-source` | Schema of a data source (v2.0+) |
| `create-comment` | Add comment to page |
| `list-users` | Workspace user list |

### Filesystem — `@modelcontextprotocol/server-filesystem` (Windows)

| Tool | Description |
|---|---|
| `read_file` | Read file contents |
| `read_multiple_files` | Read multiple files at once |
| `write_file` | Write content to file (creates or overwrites) |
| `edit_file` | Search-and-replace within file |
| `create_directory` | Create directory |
| `list_directory` | Directory listing |
| `move_file` | Move or rename file/directory |
| `search_files` | Recursive file search by name pattern |
| `get_file_info` | Metadata: size, dates, permissions |

### Browser — `@playwright/mcp`

| Tool | Description |
|---|---|
| `browser_navigate` | Navigate to URL |
| `browser_snapshot` | Accessibility tree snapshot (no screenshot needed) |
| `browser_click` | Click element by accessibility ref |
| `browser_type` | Type text into input |
| `browser_fill` | Fill form field |
| `browser_select_option` | Select from dropdown |
| `browser_screenshot` | Take screenshot (optional — requires vision capability) |
| `browser_press_key` | Press keyboard key |
| `browser_wait_for` | Wait for element/condition |
| `browser_evaluate` | Execute JavaScript in page |
| `browser_tab_new` | Open new tab |
| `browser_tab_close` | Close tab |

---

## Phase 11 — Validation Checklist

### [ ] 11.1 Backend / main process validates at startup

```typescript
// src/lib/mcp/startup-check.ts

import { resolveAllCredentials } from './config-resolver'

export async function validateMCPConfig(): Promise<void> {
  const resolved = await resolveAllCredentials()
  const active = Object.entries(resolved)
    .filter(([, v]) => v?.enabled)
    .map(([k]) => k)

  if (active.length === 0) {
    console.log('[MCP] No integrations configured. MCP tool use disabled.')
    return
  }

  console.log('[MCP] Active integrations:', active.join(', '))

  // Warn if Google is enabled but uv/uvx not found
  if (['gdrive', 'gmail', 'gcalendar'].some(k => k in resolved && (resolved as any)[k]?.enabled)) {
    try {
      const { execSync } = await import('child_process')
      execSync('uvx --version', { stdio: 'ignore' })
    } catch {
      console.warn('[MCP] WARNING: uvx not found. Google Workspace MCP requires uv/uvx. Run: curl -LsSf https://astral.sh/uv/install.sh | sh')
    }
  }

  // Warn if browser is enabled but Playwright not installed
  if (resolved.browser?.enabled) {
    try {
      const { execSync } = await import('child_process')
      execSync('npx playwright --version', { stdio: 'ignore' })
    } catch {
      console.warn('[MCP] WARNING: Playwright not found. Run: npx playwright install chromium')
    }
  }
}
```

Call `validateMCPConfig()` on app startup (before first chat request).

### [ ] 11.2 Test each integration manually

For each enabled integration, send a test prompt via chat:

```
# Slack
"List all Slack channels in my workspace."

# Google Drive
"Search for files in my Google Drive containing the word 'budget'."

# Gmail
"Show me the 5 most recent unread emails."

# Google Calendar
"What events do I have this week?"

# Notion
"Search Notion for pages about 'project'."

# Filesystem (Electron)
"List files in C:\Users\name\Documents."

# Browser (Electron)
"Navigate to https://example.com and tell me what's on the page."
```

Confirm: each prompt triggers visible tool use blocks in response content.

---

## Phase 12 — Google OAuth First-Run Flow

The `workspace-mcp` server initiates a browser OAuth flow automatically on first use. When the agent first calls a Google tool, the MCP subprocess will:

1. Print a URL to stdout
2. Wait for browser authorization
3. Save the token to `GOOGLE_OAUTH_PATH`

**In Electron:** This will launch the user's browser. Handle this in the main process by listening to the MCP server subprocess stdout and optionally surfacing the URL in the app.

**In Expo backend:** The first-run must happen on the server machine (not mobile). Log the URL to server console and open it there.

```typescript
// Optional: Electron main process — monitor MCP subprocess for OAuth URL
// Wire this into mcp-manager.ts when spawning the google_workspace server

const proc = spawn('uvx', ['workspace-mcp', '--tools', 'gmail', 'drive', 'calendar'], {
  env: { ...process.env, GOOGLE_OAUTH_CLIENT_ID: '...', GOOGLE_OAUTH_CLIENT_SECRET: '...', GOOGLE_OAUTH_PATH: '...' }
})

proc.stdout.on('data', (data: Buffer) => {
  const text = data.toString()
  const urlMatch = text.match(/https:\/\/accounts\.google\.com[^\s]+/)
  if (urlMatch) {
    // Open browser or show URL in app for user to authorize
    const { shell } = require('electron')
    shell.openExternal(urlMatch[0])
  }
})
```

---

## Phase 13 — Known Gotchas

| Issue | Fix |
|---|---|
| `@modelcontextprotocol/server-filesystem` fails on Windows paths with spaces | Use 8.3 short names or wait for official fix (PR #543 merged Aug 2025 — verify npm version is >=0.6.x) |
| `workspace-mcp` (uvx) not found | Install uv: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Google OAuth loop / token expired | Delete `GOOGLE_OAUTH_PATH` file — triggers fresh browser flow |
| Notion "Page not found" on valid page ID | Integration not connected to that page. Go to page → `···` → Connect to integration |
| Slack tool call returns empty | SLACK_TEAM_ID wrong. Verify via `https://slack.com/api/auth.test?token=TOKEN` |
| `mcp-client-2025-04-04` beta required | Always include `betas: ['mcp-client-2025-04-04']` in Anthropic SDK call |
| React Native cannot spawn subprocesses | Never try to spawn MCP servers in Expo. All subprocess logic must live on the backend Node.js server |
| keytar fails in Docker/CI | Set `MCP_MASTER_KEY` env var as fallback. Never use this in production |
| Playwright timeout on first use | Pre-install: `npx playwright install chromium` |
```
