const { validateOpenDialogOptions, validateSaveDialogOptions, ALLOWED_FILTERS } = require('../src/fileDialog');

describe('validateOpenDialogOptions', () => {
  it('defaults title + properties + filter', () => {
    const out = validateOpenDialogOptions({});
    expect(out.title).toBe('Open File');
    expect(out.properties).toEqual(['openFile']);
    expect(out.filters[0].extensions).toContain('*');
  });

  it('accepts safe properties and drops unknown ones', () => {
    const out = validateOpenDialogOptions({ properties: ['openFile', 'multiSelections', 'rm-rf'] });
    expect(out.properties).toEqual(['openFile', 'multiSelections']);
  });

  it('rejects malicious title (over-long → default)', () => {
    expect(validateOpenDialogOptions({ title: 'x'.repeat(500) }).title).toBe('Open File');
  });

  it('uses allowedFilters by name', () => {
    const out = validateOpenDialogOptions({ allowedFilters: ['notes', 'images'] });
    expect(out.filters).toHaveLength(2);
    expect(out.filters[0]).toEqual(ALLOWED_FILTERS.notes);
    expect(out.filters[1]).toEqual(ALLOWED_FILTERS.images);
  });

  it('ignores unknown filter names', () => {
    const out = validateOpenDialogOptions({ allowedFilters: ['*', 'all', 'rm'] });
    expect(out.filters[0].extensions).toContain('*'); // falls back to All-files
  });

  it('rejects path with null byte', () => {
    const out = validateOpenDialogOptions({ defaultPath: '/tmp/file\0.md' });
    expect(out.defaultPath).toBeUndefined();
  });

  it('resolves defaultPath to absolute', () => {
    const out = validateOpenDialogOptions({ defaultPath: '/tmp/x' });
    expect(out.defaultPath).toMatch(/^\//);
  });
});

describe('validateSaveDialogOptions', () => {
  it('defaults to notes filter when none provided', () => {
    const out = validateSaveDialogOptions({});
    expect(out.filters[0]).toEqual(ALLOWED_FILTERS.notes);
  });

  it('strips unsafe characters from suggestedName', () => {
    const out = validateSaveDialogOptions({ suggestedName: 'my:note?<>|file.md' });
    expect(out.suggestedName).toBe('my_note____file.md');
  });

  it('drops over-long suggestedName', () => {
    const out = validateSaveDialogOptions({ suggestedName: 'x'.repeat(500) });
    expect(out.suggestedName).toBeUndefined();
  });

  it('only allows known filters', () => {
    const out = validateSaveDialogOptions({ allowedFilters: ['unknown'] });
    // Default fallback
    expect(out.filters[0]).toEqual(ALLOWED_FILTERS.notes);
  });
});
