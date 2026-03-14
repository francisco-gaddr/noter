export type HotkeyMap = Record<string, string>;

export const HOTKEY_STORAGE_KEY = 'electronHotkeys';

export const getDefaultHotkeys = (): HotkeyMap => ({
  toggleAiSidebar: 'Ctrl+Alt+X',
  newItem: 'Ctrl+N',
  openSettings: 'Ctrl+,',
  focusSearch: 'Ctrl+F',
  toggleSidebar: 'Ctrl+B',
  switchNotes: 'Ctrl+1',
  switchTasks: 'Ctrl+2',
});

export const loadHotkeys = (): HotkeyMap => {
  if (typeof window === 'undefined') return getDefaultHotkeys();
  try {
    const raw = localStorage.getItem(HOTKEY_STORAGE_KEY);
    if (!raw) return getDefaultHotkeys();
    const parsed = JSON.parse(raw);
    return { ...getDefaultHotkeys(), ...(parsed || {}) };
  } catch {
    return getDefaultHotkeys();
  }
};

export const saveHotkeys = (map: HotkeyMap) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(map));
};

export const resetHotkeys = () => {
  saveHotkeys(getDefaultHotkeys());
};
