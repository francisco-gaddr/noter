// expo-image requires a native module at module-load. Mock the Image export
// so the prefetch hook can be imported in plain node test env.
jest.mock('expo-image', () => ({
  Image: { prefetch: jest.fn(() => Promise.resolve()) },
}));

import { _isPrefetchable } from '../../hooks/useImagePrefetch';

describe('useImagePrefetch — isPrefetchable', () => {
  it('accepts https URLs', () => {
    expect(_isPrefetchable('https://cdn.example.com/img.png')).toBe(true);
  });

  it('accepts data: image URLs', () => {
    expect(_isPrefetchable('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('rejects http (downgrade attack)', () => {
    expect(_isPrefetchable('http://cdn.example.com/img.png')).toBe(false);
  });

  it('rejects file://, ftp://, javascript:', () => {
    expect(_isPrefetchable('file:///etc/passwd')).toBe(false);
    expect(_isPrefetchable('ftp://cdn/img.png')).toBe(false);
    expect(_isPrefetchable('javascript:alert(1)')).toBe(false);
  });

  it('rejects non-image data: URLs', () => {
    expect(_isPrefetchable('data:text/html,<script>')).toBe(false);
  });

  it('rejects empty / over-long inputs', () => {
    expect(_isPrefetchable('')).toBe(false);
    expect(_isPrefetchable('https://' + 'x'.repeat(3000))).toBe(false);
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing invalid input type
    expect(_isPrefetchable(null)).toBe(false);
    // @ts-expect-error testing invalid input type
    expect(_isPrefetchable(123)).toBe(false);
  });
});
