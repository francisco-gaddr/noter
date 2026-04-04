import { getDefaultHotkeys, loadHotkeys, saveHotkeys, HOTKEY_STORAGE_KEY } from '../lib/hotkeys';

describe('hotkeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads defaults when empty', () => {
    const hotkeys = loadHotkeys();
    expect(hotkeys).toEqual(getDefaultHotkeys());
  });

  it('saves and loads custom hotkeys', () => {
    const custom = { ...getDefaultHotkeys(), toggleAiSidebar: 'Ctrl+Shift+X' };
    saveHotkeys(custom);
    const raw = localStorage.getItem(HOTKEY_STORAGE_KEY);
    expect(raw).toContain('Ctrl+Shift+X');
    const loaded = loadHotkeys();
    expect(loaded.toggleAiSidebar).toBe('Ctrl+Shift+X');
  });
});
