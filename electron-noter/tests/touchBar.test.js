const { buildTouchBarTemplate, isValidContext, KNOWN_CONTEXTS } = require('../src/touchBar');

describe('buildTouchBarTemplate', () => {
  it('default context produces newNote + spacer + settings', () => {
    const tpl = buildTouchBarTemplate('default');
    const labels = tpl.map((i) => i.label || i.type);
    expect(labels).toEqual(['New Note', 'spacer', 'Settings']);
  });

  it('note context exposes editor-relevant controls', () => {
    const tpl = buildTouchBarTemplate('note');
    const labels = tpl.map((i) => i.label || i.type);
    expect(labels).toContain('Find');
    expect(labels).toContain('Save');
  });

  it('find context exposes prev/next/close', () => {
    const tpl = buildTouchBarTemplate('find');
    const labels = tpl.map((i) => i.label || i.type);
    expect(labels).toContain('Prev');
    expect(labels).toContain('Next');
    expect(labels).toContain('Close Find');
  });

  it('wires click handlers from ctx.on by actionId', () => {
    const newNote = jest.fn();
    const find = jest.fn();
    const tpl = buildTouchBarTemplate('note', { on: { newNote, find } });
    const newBtn = tpl.find((i) => i.actionId === 'newNote');
    const findBtn = tpl.find((i) => i.actionId === 'find');
    newBtn.click();
    findBtn.click();
    expect(newNote).toHaveBeenCalled();
    expect(find).toHaveBeenCalled();
  });

  it('items without registered handlers have undefined click', () => {
    const tpl = buildTouchBarTemplate('note', { on: { newNote: jest.fn() } });
    const findBtn = tpl.find((i) => i.actionId === 'find');
    expect(findBtn.click).toBeUndefined();
  });

  it('unknown context defaults to "default" layout', () => {
    const tpl = buildTouchBarTemplate('totally-not-a-context');
    expect(tpl.map((i) => i.label || i.type)).toContain('New Note');
  });
});

describe('isValidContext', () => {
  it('accepts known contexts', () => {
    for (const c of KNOWN_CONTEXTS) expect(isValidContext(c)).toBe(true);
  });
  it('rejects unknown contexts', () => {
    expect(isValidContext('admin')).toBe(false);
    expect(isValidContext('')).toBe(false);
  });
});
