const { buildContextMenuTemplate } = require('../src/contextMenu');

const baseParams = {
  editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
  isEditable: false,
  selectionText: '',
  mediaType: 'none',
  linkURL: '',
  srcURL: '',
  x: 0,
  y: 0,
};

const baseCtx = {
  isDev: false,
  on: {
    openExternal: jest.fn(),
    writeClipboard: jest.fn(),
    find: jest.fn(),
    inspectElement: jest.fn(),
  },
};

const labels = (template) => template.map((i) => i.label || i.role || i.type);

describe('buildContextMenuTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plain right-click on non-editable text without selection: just selectAll', () => {
    const tpl = buildContextMenuTemplate(baseParams, baseCtx);
    expect(labels(tpl)).toEqual(['selectAll']);
  });

  it('right-click with selection: copy + selectAll + find', () => {
    const tpl = buildContextMenuTemplate(
      { ...baseParams, selectionText: 'hello', editFlags: { ...baseParams.editFlags, canCopy: true } },
      baseCtx
    );
    expect(labels(tpl)).toEqual(['copy', 'selectAll', 'separator', 'Find in Page…']);
  });

  it('right-click on editable: full edit-flag-aware role list', () => {
    const tpl = buildContextMenuTemplate(
      {
        ...baseParams,
        isEditable: true,
        editFlags: { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
      },
      baseCtx
    );
    expect(labels(tpl)).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('right-click on link: Open in Browser + Copy Link', () => {
    const tpl = buildContextMenuTemplate(
      { ...baseParams, linkURL: 'https://example.com/foo' },
      baseCtx
    );
    expect(labels(tpl).slice(0, 3)).toEqual(['Open Link in Browser', 'Copy Link Address', 'separator']);
    tpl[0].click();
    expect(baseCtx.on.openExternal).toHaveBeenCalledWith('https://example.com/foo');
    tpl[1].click();
    expect(baseCtx.on.writeClipboard).toHaveBeenCalledWith('https://example.com/foo');
  });

  it('in dev mode: appends "Inspect Element" with coords', () => {
    const tpl = buildContextMenuTemplate(
      { ...baseParams, x: 42, y: 99, editFlags: { ...baseParams.editFlags, canCopy: true } },
      { ...baseCtx, isDev: true }
    );
    const last = tpl[tpl.length - 1];
    expect(last.label).toBe('Inspect Element');
    last.click();
    expect(baseCtx.on.inspectElement).toHaveBeenCalledWith(42, 99);
  });

  it('production hides Inspect Element', () => {
    const tpl = buildContextMenuTemplate(baseParams, { ...baseCtx, isDev: false });
    expect(tpl.some((i) => i.label === 'Inspect Element')).toBe(false);
  });

  it('"Find in Page" callback receives selection text', () => {
    const tpl = buildContextMenuTemplate(
      { ...baseParams, selectionText: 'needle', editFlags: { ...baseParams.editFlags, canCopy: true } },
      baseCtx
    );
    const findItem = tpl.find((i) => i.label === 'Find in Page…');
    findItem.click();
    expect(baseCtx.on.find).toHaveBeenCalledWith('needle');
  });
});
