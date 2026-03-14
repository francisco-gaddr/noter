import { createEmptyMcpUiSettings } from '@repo/shared';
import { buildResolvedMcpRuntimeConfig, isExplicitServiceIntent, mcpRuntimeInternals } from '../src/services/mcp/runtime';

describe('mcp runtime config', () => {
  it('prioritizes ui values over env values', () => {
    const ui = createEmptyMcpUiSettings();
    ui.notion.enabled = true;
    ui.notion.values.apiToken = 'ui-token';
    const config = buildResolvedMcpRuntimeConfig(ui, {
      MCP_NOTION_API_TOKEN: 'env-token',
      MCP_NOTION_ENABLED: 'true',
    });
    expect(config.notion.enabled).toBe(true);
    expect(config.notion.env.NOTION_TOKEN).toBe('ui-token');
  });

  it('uses env fallback when ui is empty', () => {
    const config = buildResolvedMcpRuntimeConfig(createEmptyMcpUiSettings(), {
      MCP_SLACK_ENABLED: 'true',
      MCP_SLACK_BOT_TOKEN: 'env-slack-token',
      MCP_SLACK_TEAM_ID: 'T123',
    });
    expect(config.slack.enabled).toBe(true);
    expect(config.slack.env.SLACK_BOT_TOKEN).toBe('env-slack-token');
  });

  it('requires explicit service mention for guarded services', () => {
    expect(isExplicitServiceIntent('notion', 'lägg till detta i notion')).toBe(true);
    expect(isExplicitServiceIntent('googleWorkspace', 'skapa i min kalender')).toBe(true);
    expect(isExplicitServiceIntent('slack', 'skicka det i slack')).toBe(true);
    expect(isExplicitServiceIntent('notion', 'lägg till detta')).toBe(false);
  });

  it('enforces tool policy allowlist by integration', () => {
    expect(mcpRuntimeInternals.isToolAllowedByPolicy('notion', 'notion.search')).toBe(true);
    expect(mcpRuntimeInternals.isToolAllowedByPolicy('googleWorkspace', 'calendar.create_event')).toBe(true);
    expect(mcpRuntimeInternals.isToolAllowedByPolicy('notion', 'slack.send_message')).toBe(false);
  });

  it('rejects missing required integration credentials when enabled', () => {
    const ui = createEmptyMcpUiSettings();
    ui.notion.enabled = true;
    expect(() => buildResolvedMcpRuntimeConfig(ui, {})).toThrow('Saknar obligatorisk konfiguration');
  });

  it('rejects oversized payload input', () => {
    const huge = 'x'.repeat(230000);
    expect(() => buildResolvedMcpRuntimeConfig(huge, {})).toThrow('MCP payload är för stor');
  });

  it('sanitizes safe arguments and blocks dangerous keys', () => {
    const safe = mcpRuntimeInternals.sanitizeArgs({ query: 'roadmap', limit: 5, nested: { includeDone: false } });
    expect((safe as any).query).toBe('roadmap');
    expect(() => mcpRuntimeInternals.sanitizeArgs({ constructor: { polluted: true } })).toThrow('förbjuden nyckel');
  });
});
