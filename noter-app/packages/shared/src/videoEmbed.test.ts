import { resolveVideoEmbed, buildVideoEmbedHtml, escapeHtmlAttr } from './videoEmbed';

describe('resolveVideoEmbed', () => {
  it('resolves classic youtube watch URLs', () => {
    const r = resolveVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s');
    expect(r?.provider).toBe('youtube');
    expect(r?.embedUrl).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('resolves youtu.be short links (with tracking params)', () => {
    const r = resolveVideoEmbed('https://youtu.be/abc123?si=xyz');
    expect(r?.videoId).toBe('abc123');
  });

  it.each(['shorts', 'live', 'embed'])('resolves youtube /%s/ URLs', (kind) => {
    const r = resolveVideoEmbed(`https://www.youtube.com/${kind}/abc_-123`);
    expect(r?.provider).toBe('youtube');
    expect(r?.videoId).toBe('abc_-123');
  });

  it('resolves vimeo page and player URLs', () => {
    expect(resolveVideoEmbed('https://vimeo.com/123456789')?.embedUrl)
      .toBe('https://player.vimeo.com/video/123456789');
    expect(resolveVideoEmbed('https://player.vimeo.com/video/123456789')?.provider).toBe('vimeo');
  });

  it('resolves tiktok video URLs', () => {
    expect(resolveVideoEmbed('https://www.tiktok.com/@user/video/1234567890')?.embedUrl)
      .toBe('https://www.tiktok.com/embed/v2/1234567890');
  });

  it('classifies direct video files', () => {
    const r = resolveVideoEmbed('https://example.com/media/clip.mp4');
    expect(r?.provider).toBe('file');
  });

  it('adds https:// to bare domains', () => {
    expect(resolveVideoEmbed('youtu.be/abc123')?.provider).toBe('youtube');
  });

  it('rejects non-http schemes and garbage', () => {
    expect(resolveVideoEmbed('javascript:alert(1)')).toBeNull();
    expect(resolveVideoEmbed('')).toBeNull();
    expect(resolveVideoEmbed('   ')).toBeNull();
  });

  it('does NOT treat lookalike hosts as youtube', () => {
    // evil-youtube.com is not a youtube.com subdomain
    const r = resolveVideoEmbed('https://evil-youtube.com/watch?v=abc123');
    expect(r?.provider).toBe('generic');
  });

  it('rejects youtube URLs with invalid ids instead of embedding junk', () => {
    expect(resolveVideoEmbed('https://www.youtube.com/watch?v=<script>')).toBeNull();
  });
});

describe('buildVideoEmbedHtml (WebView safety)', () => {
  it('produces a sandboxed lazy iframe for youtube', () => {
    const html = buildVideoEmbedHtml('https://youtu.be/abc123');
    expect(html).toContain('<iframe');
    expect(html).toContain('sandbox=');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('https://www.youtube.com/embed/abc123');
  });

  it('produces a native <video> tag for direct files', () => {
    const html = buildVideoEmbedHtml('https://example.com/a.webm');
    expect(html).toContain('<video');
    expect(html).not.toContain('<iframe');
  });

  it('cannot be broken out of via attribute injection', () => {
    // Raw quotes in the input must never survive into the HTML attribute.
    const html = buildVideoEmbedHtml('https://example.com/x?q="  onload="alert(1)');
    expect(html === '' || (!html.includes('" onload') && !html.includes('"  onload'))).toBe(true);
  });

  it('returns empty string for invalid input', () => {
    expect(buildVideoEmbedHtml('javascript:alert(1)')).toBe('');
  });
});

describe('escapeHtmlAttr', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtmlAttr(`&"'<>`)).toBe('&amp;&quot;&#39;&lt;&gt;');
  });
});
