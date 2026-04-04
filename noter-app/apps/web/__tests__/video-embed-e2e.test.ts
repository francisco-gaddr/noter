import { getTikTokEmbedUrl, getYouTubeEmbedUrl, resolveVideoEmbedUrl } from '../lib/videoEmbed';

describe('video embed e2e', () => {
  it('builds youtube relay embed url', () => {
    const url = 'https://youtu.be/abc123?si=1';
    const embed = getYouTubeEmbedUrl(url, 'https://example.com/app');
    expect(embed).toBe('https://example.com/app/embed/youtube?id=abc123');
  });

  it('builds tiktok embed url', () => {
    const url = 'https://www.tiktok.com/@user/video/1234567890';
    const embed = getTikTokEmbedUrl(url);
    expect(embed).toBe('https://www.tiktok.com/embed/v2/1234567890');
  });

  it('resolves embed url from input', () => {
    const url = 'https://www.youtube.com/watch?v=xyz999';
    const embed = resolveVideoEmbedUrl(url, 'https://example.com/app');
    expect(embed).toBe('https://example.com/app/embed/youtube?id=xyz999');
  });
});
