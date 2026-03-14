import { createEmptyMcpUiSettings, resolveMcpSettings } from '@repo/shared/src/mcpSettings';

describe('mcp settings resolution (mobile)', () => {
  it('activates integration when ui has values', () => {
    const ui = createEmptyMcpUiSettings();
    ui.playwright.values.browser = 'chromium';
    const resolved = resolveMcpSettings(ui, {});
    expect(resolved.playwright.enabled).toBe(true);
    expect(resolved.playwright.fields.browser.value).toBe('chromium');
    expect(resolved.playwright.fields.browser.source).toBe('ui');
  });

  it('keeps disabled when neither env nor ui has values', () => {
    const ui = createEmptyMcpUiSettings();
    const resolved = resolveMcpSettings(ui, {});
    expect(resolved.googleWorkspace.enabled).toBe(false);
    expect(resolved.googleWorkspace.enabledSource).toBe('default');
  });
});
