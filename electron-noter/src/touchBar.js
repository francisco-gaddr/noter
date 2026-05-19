/**
 * Touch Bar template builder (macOS only).
 *
 * Pure function — returns an array of `{ type, label, accelerator?, click }`
 * descriptors that the caller turns into Electron TouchBar* items. Keeping
 * the construction logic separate from the Electron module lets us unit-
 * test the layout decisions without booting Electron.
 *
 * Three contexts: 'default' (any window), 'note' (note editor visible),
 * 'find' (find-in-page active). The host swaps templates when the active
 * surface changes.
 */

const buildTouchBarTemplate = (context, ctx = {}) => {
  const { on } = ctx;
  const handlers = on || {};

  const noteItems = [
    { type: 'button', label: 'New Note', icon: 'plus', actionId: 'newNote' },
    { type: 'button', label: 'Find', icon: 'magnifyingglass', actionId: 'find' },
    { type: 'spacer', size: 'flexible' },
    { type: 'button', label: 'Save', icon: 'square.and.arrow.down', actionId: 'save' },
  ];

  const findItems = [
    { type: 'button', label: 'Prev', icon: 'chevron.up', actionId: 'findPrev' },
    { type: 'button', label: 'Next', icon: 'chevron.down', actionId: 'findNext' },
    { type: 'spacer', size: 'flexible' },
    { type: 'button', label: 'Close Find', icon: 'xmark', actionId: 'findStop' },
  ];

  const defaultItems = [
    { type: 'button', label: 'New Note', icon: 'plus', actionId: 'newNote' },
    { type: 'spacer', size: 'large' },
    { type: 'button', label: 'Settings', icon: 'gearshape', actionId: 'openSettings' },
  ];

  const items = context === 'note'
    ? noteItems
    : context === 'find'
    ? findItems
    : defaultItems;

  // Resolve click handlers from `ctx.on.<actionId>`. Items without a
  // registered handler render but are no-ops — useful in tests + for
  // partial host wiring.
  return items.map((it) => ({
    ...it,
    click: typeof handlers[it.actionId] === 'function' ? handlers[it.actionId] : undefined,
  }));
};

const KNOWN_CONTEXTS = ['default', 'note', 'find'];
const isValidContext = (c) => KNOWN_CONTEXTS.includes(c);

module.exports = {
  buildTouchBarTemplate,
  isValidContext,
  KNOWN_CONTEXTS,
};
