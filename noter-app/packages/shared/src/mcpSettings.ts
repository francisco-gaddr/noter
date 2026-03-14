export type McpIntegrationId = 'slack' | 'googleWorkspace' | 'notion' | 'filesystem' | 'playwright';

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
