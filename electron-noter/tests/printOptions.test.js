const { validatePrintOptions, ALLOWED_PAGE_SIZES } = require('../src/printOptions');

describe('validatePrintOptions (print)', () => {
  it('returns sane defaults for empty input', () => {
    const out = validatePrintOptions({}, { kind: 'print' });
    expect(out.copies).toBe(1);
    expect(out.pageSize).toBe('A4');
    expect(out.landscape).toBe(false);
    expect(out.silent).toBe(false);
  });

  it('caps copies between 1 and 20', () => {
    expect(validatePrintOptions({ copies: 0 }, { kind: 'print' }).copies).toBe(1);
    expect(validatePrintOptions({ copies: 50 }, { kind: 'print' }).copies).toBe(1); // 50 fails the check → defaults
    expect(validatePrintOptions({ copies: 5 }, { kind: 'print' }).copies).toBe(5);
    expect(validatePrintOptions({ copies: 20 }, { kind: 'print' }).copies).toBe(20);
  });

  it('accepts allowed page sizes', () => {
    for (const size of ALLOWED_PAGE_SIZES) {
      expect(validatePrintOptions({ pageSize: size }, { kind: 'print' }).pageSize).toBe(size);
    }
  });

  it('rejects unrecognised page-size strings, defaults to A4', () => {
    expect(validatePrintOptions({ pageSize: 'Z9' }, { kind: 'print' }).pageSize).toBe('A4');
  });

  it('accepts custom page sizes in microns, clamped to a safe range', () => {
    const out = validatePrintOptions({ pageSize: { width: 100_000, height: 200_000 } }, { kind: 'print' });
    expect(out.pageSize).toEqual({ width: 100_000, height: 200_000 });
  });

  it('rejects custom page sizes below 1mm or above 2 m', () => {
    const a = validatePrintOptions({ pageSize: { width: 1, height: 1 } }, { kind: 'print' });
    expect(a.pageSize).toBe('A4');
    const b = validatePrintOptions({ pageSize: { width: 9_999_999, height: 999 } }, { kind: 'print' });
    expect(b.pageSize).toBe('A4');
  });

  it('clamps margins to 0-50mm', () => {
    const out = validatePrintOptions({ margins: { top: -1, bottom: 100, left: 5, right: 'oops' } }, { kind: 'print' });
    expect(out.margins).toEqual({ top: 10, bottom: 10, left: 5, right: 10 });
  });

  it('rejects deviceName strings longer than 256 chars', () => {
    const out = validatePrintOptions({ deviceName: 'x'.repeat(500) }, { kind: 'print' });
    expect(out.deviceName).toBeUndefined();
  });
});

describe('validatePrintOptions (pdf)', () => {
  it('accepts scale in (0.1, 5]', () => {
    expect(validatePrintOptions({ scale: 1.5 }, { kind: 'pdf' }).scale).toBe(1.5);
  });

  it('rejects out-of-range scale', () => {
    expect(validatePrintOptions({ scale: 0 }, { kind: 'pdf' }).scale).toBeUndefined();
    expect(validatePrintOptions({ scale: 100 }, { kind: 'pdf' }).scale).toBeUndefined();
  });

  it('passes through preferCSSPageSize boolean', () => {
    expect(validatePrintOptions({ preferCSSPageSize: true }, { kind: 'pdf' }).preferCSSPageSize).toBe(true);
    expect(validatePrintOptions({ preferCSSPageSize: false }, { kind: 'pdf' }).preferCSSPageSize).toBe(false);
  });

  it('does NOT include print-only fields in pdf output', () => {
    const out = validatePrintOptions({ copies: 5, silent: true }, { kind: 'pdf' });
    expect(out.copies).toBeUndefined();
    expect(out.silent).toBeUndefined();
  });
});
