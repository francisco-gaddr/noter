export type HotkeyMap = Record<string, string>;

export const HOTKEY_STORAGE_KEY = 'electronHotkeys';

export const getDefaultHotkeys = (): HotkeyMap => ({
  toggleAiSidebar: 'Ctrl+Alt+X',
  toggleSplitView: 'Ctrl+Alt+V',
  newItem: 'Ctrl+N',
  openSettings: 'Ctrl+,',
  focusSearch: 'Ctrl+F',
  toggleSidebar: 'Ctrl+B',
  switchNotes: 'Ctrl+1',
  switchTasks: 'Ctrl+2',
});

const normalizeKeyToken = (token: string): string => token.trim().toLowerCase();

export const matchesHotkey = (event: KeyboardEvent, combo?: string | null): boolean => {
  if (!combo || typeof combo !== 'string') return false;
  const parts = combo
    .split('+')
    .map(normalizeKeyToken)
    .filter(Boolean);
  if (parts.length === 0) return false;
  const requiredCtrl = parts.includes('ctrl') || parts.includes('control');
  const requiredAlt = parts.includes('alt') || parts.includes('option');
  const requiredShift = parts.includes('shift');
  const requiredMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
  const keyPart = parts.find((part) => !['ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'command'].includes(part));
  const normalizedKey = normalizeKeyToken(event.key);
  if (requiredCtrl !== event.ctrlKey) return false;
  if (requiredAlt !== event.altKey) return false;
  if (requiredShift !== event.shiftKey) return false;
  if (requiredMeta !== event.metaKey) return false;
  if (!keyPart) return true;
  return normalizedKey === keyPart;
};

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
