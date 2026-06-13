import {
  createEmptyMcpUiSettings,
  mcpSettingsToJson,
  mcpSettingsToJsonString,
  mcpSettingsFromJson,
} from './mcpSettings';

describe('mcp JSON import/export', () => {
  it('exports only enabled/populated servers in the portable flat shape', () => {
    const ui = createEmptyMcpUiSettings();
    ui.slack.enabled = true;
    ui.slack.values.botToken = 'xoxb-123';
    ui.slack.values.teamId = 'T1';
    // github left empty → omitted
    const json = mcpSettingsToJson(ui);
    expect(json.mcpServers.slack).toEqual({ enabled: true, botToken: 'xoxb-123', teamId: 'T1' });
    expect(json.mcpServers.github).toBeUndefined();
  });

  it('round-trips through string export and import', () => {
    const ui = createEmptyMcpUiSettings();
    ui.github.enabled = true;
    ui.github.values.token = 'ghp_abc';
    const restored = mcpSettingsFromJson(mcpSettingsToJsonString(ui));
    expect(restored.github.enabled).toBe(true);
    expect(restored.github.values.token).toBe('ghp_abc');
  });

  it('accepts the Claude-Desktop-style mcpServers flat shape', () => {
    const restored = mcpSettingsFromJson(
      JSON.stringify({ mcpServers: { notion: { enabled: true, apiToken: 'secret_x' } } })
    );
    expect(restored.notion.enabled).toBe(true);
    expect(restored.notion.values.apiToken).toBe('secret_x');
  });

  it('accepts the internal nested {values} shape and ignores unknown servers/fields', () => {
    const restored = mcpSettingsFromJson(
      JSON.stringify({ slack: { enabled: true, values: { botToken: 'xoxb-9', bogus: 'x' } }, unknownServer: { enabled: true } })
    );
    expect(restored.slack.values.botToken).toBe('xoxb-9');
    expect((restored.slack.values as Record<string, string>).bogus).toBeUndefined();
  });

  it('infers enabled from presence of values when no explicit flag', () => {
    const restored = mcpSettingsFromJson(JSON.stringify({ mcpServers: { github: { token: 'ghp_y' } } }));
    expect(restored.github.enabled).toBe(true);
    expect(restored.github.values.token).toBe('ghp_y');
  });

  it('returns an empty config for blank input and throws on invalid JSON', () => {
    expect(mcpSettingsFromJson('   ')).toEqual(createEmptyMcpUiSettings());
    expect(() => mcpSettingsFromJson('{ not json')).toThrow();
  });
});
