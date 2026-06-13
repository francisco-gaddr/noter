export type McpIntegrationId = 'slack' | 'googleWorkspace' | 'notion' | 'filesystem' | 'playwright' | 'github';

export type McpFieldDefinition = {
  key: string;
  label: string;
  secret: boolean;
  envKeys: string[];
  placeholder?: string;
};

export type McpIntegrationDefinition = {
  id: McpIntegrationId;
  label: string;
  envEnabledKeys: string[];
  fields: McpFieldDefinition[];
};

export type McpIntegrationSettings = {
  enabled: boolean;
  values: Record<string, string>;
};

export type McpUiSettings = Record<McpIntegrationId, McpIntegrationSettings>;

export type McpValueSource = 'ui' | 'env' | 'default';

export type McpResolvedField = {
  value: string;
  source: McpValueSource;
};

export type McpResolvedIntegration = {
  enabled: boolean;
  enabledSource: McpValueSource;
  fields: Record<string, McpResolvedField>;
};

export type McpResolvedSettings = Record<McpIntegrationId, McpResolvedIntegration>;

const toTrimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const toBool = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const readFirstEnv = (env: Record<string, string | undefined>, keys: string[]) => {
  for (const key of keys) {
    const raw = env[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value) return value;
  }
  return '';
};

export const MCP_INTEGRATIONS: McpIntegrationDefinition[] = [
  {
    id: 'slack',
    label: 'Slack',
    envEnabledKeys: ['MCP_SLACK_ENABLED', 'SLACK_MCP_ENABLED'],
    fields: [
      { key: 'botToken', label: 'Bot Token', secret: true, envKeys: ['MCP_SLACK_BOT_TOKEN', 'SLACK_BOT_TOKEN'], placeholder: 'xoxb-...' },
      { key: 'teamId', label: 'Team ID', secret: false, envKeys: ['MCP_SLACK_TEAM_ID', 'SLACK_TEAM_ID'], placeholder: 'T01234567' },
      { key: 'channelIds', label: 'Channel IDs', secret: false, envKeys: ['MCP_SLACK_CHANNEL_IDS', 'SLACK_CHANNEL_IDS'], placeholder: 'C1,C2,C3' },
    ],
  },
  {
    id: 'googleWorkspace',
    label: 'Google Workspace',
    envEnabledKeys: ['MCP_GOOGLE_WORKSPACE_ENABLED', 'GOOGLE_WORKSPACE_MCP_ENABLED'],
    fields: [
      { key: 'clientId', label: 'OAuth Client ID', secret: true, envKeys: ['MCP_GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'], placeholder: '...apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'OAuth Client Secret', secret: true, envKeys: ['MCP_GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET'], placeholder: 'GOCSPX-...' },
      { key: 'redirectUri', label: 'Redirect URI', secret: false, envKeys: ['MCP_GOOGLE_OAUTH_REDIRECT_URI', 'GOOGLE_OAUTH_REDIRECT_URI'], placeholder: 'http://localhost:3001/oauth/callback' },
      { key: 'oauthPath', label: 'OAuth Path', secret: false, envKeys: ['MCP_GOOGLE_OAUTH_PATH', 'GOOGLE_OAUTH_PATH'], placeholder: '.mcp-google-oauth.json' },
    ],
  },
  {
    id: 'notion',
    label: 'Notion',
    envEnabledKeys: ['MCP_NOTION_ENABLED', 'NOTION_MCP_ENABLED'],
    fields: [
      { key: 'apiToken', label: 'Integration Token', secret: true, envKeys: ['MCP_NOTION_API_TOKEN', 'NOTION_API_TOKEN'], placeholder: 'secret_...' },
      { key: 'workspaceId', label: 'Workspace ID', secret: false, envKeys: ['MCP_NOTION_WORKSPACE_ID', 'NOTION_WORKSPACE_ID'], placeholder: 'optional' },
    ],
  },
  {
    id: 'filesystem',
    label: 'Filesystem',
    envEnabledKeys: ['MCP_FILESYSTEM_ENABLED', 'FILESYSTEM_MCP_ENABLED'],
    fields: [
      { key: 'allowedPaths', label: 'Allowed Paths', secret: false, envKeys: ['MCP_FILESYSTEM_ALLOWED_PATHS', 'FILESYSTEM_ALLOWED_PATHS'], placeholder: 'C:\\Users\\name\\Documents;D:\\Data' },
    ],
  },
  {
    id: 'playwright',
    label: 'Playwright Browser',
    envEnabledKeys: ['MCP_PLAYWRIGHT_ENABLED', 'PLAYWRIGHT_MCP_ENABLED'],
    fields: [
      { key: 'browser', label: 'Browser', secret: false, envKeys: ['MCP_PLAYWRIGHT_BROWSER', 'PLAYWRIGHT_BROWSER'], placeholder: 'chromium' },
      { key: 'headless', label: 'Headless', secret: false, envKeys: ['MCP_PLAYWRIGHT_HEADLESS', 'PLAYWRIGHT_HEADLESS'], placeholder: 'true' },
      { key: 'channel', label: 'Channel', secret: false, envKeys: ['MCP_PLAYWRIGHT_CHANNEL', 'PLAYWRIGHT_CHANNEL'], placeholder: 'chrome' },
    ],
  },
  {
    id: 'github',
    label: 'GitHub',
    envEnabledKeys: ['MCP_GITHUB_ENABLED', 'GITHUB_MCP_ENABLED'],
    fields: [
      { key: 'token', label: 'Personal Access Token', secret: true, envKeys: ['MCP_GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN'], placeholder: 'github_pat_... / ghp_...' },
    ],
  },
];

export const createEmptyMcpUiSettings = (): McpUiSettings => {
  const result = {} as McpUiSettings;
  for (const integration of MCP_INTEGRATIONS) {
    result[integration.id] = { enabled: false, values: {} };
    for (const field of integration.fields) {
      result[integration.id].values[field.key] = '';
    }
  }
  return result;
};

export const normalizeMcpUiSettings = (input: unknown): McpUiSettings => {
  const base = createEmptyMcpUiSettings();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const source = input as Record<string, any>;
  for (const integration of MCP_INTEGRATIONS) {
    const row = source[integration.id];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    base[integration.id].enabled = Boolean(row.enabled);
    const rowValues = row.values && typeof row.values === 'object' && !Array.isArray(row.values) ? row.values : {};
    for (const field of integration.fields) {
      base[integration.id].values[field.key] = toTrimmed((rowValues as Record<string, unknown>)[field.key]);
    }
  }
  return base;
};

export const resolveMcpSettings = (
  uiSettings: McpUiSettings,
  env: Record<string, string | undefined>
): McpResolvedSettings => {
  const resolved = {} as McpResolvedSettings;
  for (const integration of MCP_INTEGRATIONS) {
    const ui = uiSettings[integration.id] ?? { enabled: false, values: {} };
    const envEnabledRaw = readFirstEnv(env, integration.envEnabledKeys);
    const envEnabled = envEnabledRaw ? toBool(envEnabledRaw) : false;
    const fieldResult: Record<string, McpResolvedField> = {};
    let hasAnyUiValue = false;
    let hasAnyEnvValue = false;
    for (const field of integration.fields) {
      const uiValue = toTrimmed(ui.values[field.key]);
      const envValue = readFirstEnv(env, field.envKeys);
      if (uiValue) {
        fieldResult[field.key] = { value: uiValue, source: 'ui' };
        hasAnyUiValue = true;
      } else if (envValue) {
        fieldResult[field.key] = { value: envValue, source: 'env' };
        hasAnyEnvValue = true;
      } else {
        fieldResult[field.key] = { value: '', source: 'default' };
      }
    }
    let enabled = false;
    let enabledSource: McpValueSource = 'default';
    if (ui.enabled || hasAnyUiValue) {
      enabled = true;
      enabledSource = 'ui';
    } else if (envEnabled || hasAnyEnvValue) {
      enabled = true;
      enabledSource = 'env';
    }
    resolved[integration.id] = {
      enabled,
      enabledSource,
      fields: fieldResult,
    };
  }
  return resolved;
};

export const toEffectiveMcpUiSettings = (resolved: McpResolvedSettings): McpUiSettings => {
  const output = createEmptyMcpUiSettings();
  for (const integration of MCP_INTEGRATIONS) {
    const row = resolved[integration.id];
    output[integration.id].enabled = row.enabled;
    for (const field of integration.fields) {
      output[integration.id].values[field.key] = row.fields[field.key]?.value ?? '';
    }
  }
  return output;
};

export const maskSecret = (value: string) => {
  const text = toTrimmed(value);
  if (!text) return '';
  if (text.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
};

/**
 * Serialise the MCP UI settings into a portable, human-editable JSON object —
 * the same `{ mcpServers: { <id>: { enabled, ...flatValues } } }` shape Claude
 * Desktop and friends use. Only enabled servers or servers with any value are
 * included, so an exported config stays minimal. This is the "easy custom MCP
 * JSON" the user can copy between devices or hand-edit and paste back.
 */
export const mcpSettingsToJson = (ui: McpUiSettings): { mcpServers: Record<string, Record<string, unknown>> } => {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const integration of MCP_INTEGRATIONS) {
    const row = ui[integration.id];
    if (!row) continue;
    const flat: Record<string, unknown> = {};
    let hasValue = false;
    for (const field of integration.fields) {
      const value = toTrimmed(row.values?.[field.key]);
      if (value) { flat[field.key] = value; hasValue = true; }
    }
    if (row.enabled || hasValue) {
      mcpServers[integration.id] = { enabled: Boolean(row.enabled), ...flat };
    }
  }
  return { mcpServers };
};

export const mcpSettingsToJsonString = (ui: McpUiSettings): string =>
  JSON.stringify(mcpSettingsToJson(ui), null, 2);

/**
 * Parse a pasted MCP JSON config into UI settings. Tolerant by design — accepts
 * either:
 *   - the portable `{ mcpServers: { slack: { enabled, botToken, ... } } }` shape
 *     (flat values), or
 *   - our internal `{ slack: { enabled, values: { botToken, ... } } }` shape.
 * Unknown server ids and unknown fields are ignored; values are trimmed. Throws
 * a clear error on invalid JSON so the UI can surface it.
 */
export const mcpSettingsFromJson = (input: string | unknown): McpUiSettings => {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return createEmptyMcpUiSettings();
    parsed = JSON.parse(trimmed); // let SyntaxError bubble up for the UI to show
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return createEmptyMcpUiSettings();
  }
  const root = parsed as Record<string, any>;
  // Unwrap the `mcpServers` envelope if present; otherwise treat the object as
  // the server map directly.
  const servers = (root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers))
    ? root.mcpServers as Record<string, any>
    : root;

  const base = createEmptyMcpUiSettings();
  for (const integration of MCP_INTEGRATIONS) {
    const row = servers[integration.id];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    // Flat shape keeps values at the top level; internal shape nests them.
    const flat = (row.values && typeof row.values === 'object' && !Array.isArray(row.values))
      ? row.values as Record<string, unknown>
      : row as Record<string, unknown>;
    let hasValue = false;
    for (const field of integration.fields) {
      const value = toTrimmed(flat[field.key]);
      base[integration.id].values[field.key] = value;
      if (value) hasValue = true;
    }
    base[integration.id].enabled = 'enabled' in row ? toBool(row.enabled) : hasValue;
  }
  return base;
};
