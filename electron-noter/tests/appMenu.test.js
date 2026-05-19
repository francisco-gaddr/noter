const { buildAppMenuTemplate } = require('../src/appMenu');

const fakeCtx = (over = {}) => ({
  app: { getName: () => 'Noter', getVersion: () => '1.2.3', ...(over.app || {}) },
  shell: { openExternal: jest.fn() },
  on: {
    quit: jest.fn(),
    checkUpdate: jest.fn(),
    openAbout: jest.fn(),
    toggleDevTools: jest.fn(),
  },
  isDev: false,
  isMac: false,
  ...over,
});

describe('buildAppMenuTemplate', () => {
  it('produces File/Edit/View/Window/Help on Windows/Linux', () => {
    const tpl = buildAppMenuTemplate(fakeCtx({ isMac: false }));
    const labels = tpl.map((t) => t.label || t.role);
    expect(labels).toEqual(['File', 'Edit', 'View', 'Window', 'Help']);
  });

  it('prepends the app menu on macOS', () => {
    const tpl = buildAppMenuTemplate(fakeCtx({ isMac: true }));
    const labels = tpl.map((t) => t.label || t.role);
    expect(labels[0]).toBe('Noter');
    expect(labels).toContain('File');
    expect(labels).toContain('Help');
  });

  it('hides DevTools toggle in production', () => {
    const tpl = buildAppMenuTemplate(fakeCtx({ isDev: false }));
    const view = tpl.find((t) => t.label === 'View');
    const items = (view.submenu || []).map((i) => i.role || i.label);
    expect(items).not.toContain('toggleDevTools');
  });

  it('exposes DevTools toggle in dev', () => {
    const tpl = buildAppMenuTemplate(fakeCtx({ isDev: true }));
    const view = tpl.find((t) => t.label === 'View');
    const roles = (view.submenu || []).map((i) => i.role);
    expect(roles).toContain('toggleDevTools');
  });

  it('Help menu has Check-for-Updates entry that triggers callback', () => {
    const ctx = fakeCtx();
    const tpl = buildAppMenuTemplate(ctx);
    const help = tpl.find((t) => t.role === 'help' || t.label === 'Help');
    const item = (help.submenu || []).find((i) => i.label === 'Check for Updates…');
    expect(item).toBeDefined();
    item.click();
    expect(ctx.on.checkUpdate).toHaveBeenCalled();
  });

  it('Learn More opens external URL', () => {
    const ctx = fakeCtx();
    const tpl = buildAppMenuTemplate(ctx);
    const help = tpl.find((t) => t.role === 'help' || t.label === 'Help');
    const item = (help.submenu || []).find((i) => i.label === 'Learn More');
    item.click();
    expect(ctx.shell.openExternal).toHaveBeenCalledWith(expect.stringContaining('http'));
  });

  it('non-mac Help menu surfaces About via the help submenu', () => {
    const ctx = fakeCtx({ isMac: false });
    const tpl = buildAppMenuTemplate(ctx);
    const help = tpl.find((t) => t.role === 'help' || t.label === 'Help');
    const item = (help.submenu || []).find((i) => typeof i.label === 'string' && i.label.startsWith('About'));
    expect(item).toBeDefined();
    item.click();
    expect(ctx.on.openAbout).toHaveBeenCalled();
  });
});
