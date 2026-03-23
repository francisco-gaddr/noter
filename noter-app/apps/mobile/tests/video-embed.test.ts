import { getVideoEmbedUrl, getVideoEmbedHtml } from '../utils/video';

describe('video embed utils', () => {
  it('creates youtube embed url', () => {
    const url = 'https://youtu.be/abc123?si=1';
    const embed = getVideoEmbedUrl(url);
    expect(embed).toContain('https://daylited.com/embed/youtube?id=abc123');
  });

  it('creates tiktok embed url', () => {
    const url = 'https://www.tiktok.com/@user/video/1234567890';
    const embed = getVideoEmbedUrl(url);
    expect(embed).toBe('https://www.tiktok.com/embed/v2/1234567890');
  });

  it('creates iframe html', () => {
    const html = getVideoEmbedHtml('https://youtu.be/abc123');
    expect(html).toContain('<iframe');
    expect(html).toContain('https://daylited.com/embed/youtube?id=abc123');
  });
});
