import { createEmptyMcpUiSettings, resolveMcpSettings } from '../../../packages/shared/src/mcpSettings';

describe('mcp settings resolution (web)', () => {
  it('uses ui values over env values', () => {
    const ui = createEmptyMcpUiSettings();
    ui.slack.enabled = true;
    ui.slack.values.botToken = 'ui-token';
    const resolved = resolveMcpSettings(ui, {
      MCP_SLACK_BOT_TOKEN: 'env-token',
      MCP_SLACK_ENABLED: 'true',
    });
    expect(resolved.slack.enabled).toBe(true);
    expect(resolved.slack.fields.botToken.value).toBe('ui-token');
    expect(resolved.slack.fields.botToken.source).toBe('ui');
  });

  it('falls back to env values when ui is empty', () => {
    const ui = createEmptyMcpUiSettings();
    const resolved = resolveMcpSettings(ui, {
      MCP_NOTION_API_TOKEN: 'env-notion',
      MCP_NOTION_ENABLED: 'true',
    });
    expect(resolved.notion.enabled).toBe(true);
    expect(resolved.notion.fields.apiToken.value).toBe('env-notion');
    expect(resolved.notion.fields.apiToken.source).toBe('env');
  });
});
