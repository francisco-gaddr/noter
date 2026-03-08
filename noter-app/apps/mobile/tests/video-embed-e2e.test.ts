import { getVideoEmbedHtml } from '../utils/video';
import { tiptapJsonToHtml } from '../utils/tiptap';

describe('video embed e2e', () => {
  it('keeps iframe content when saving and rendering html', () => {
    const html = getVideoEmbedHtml('https://youtu.be/abc123');
    const rendered = tiptapJsonToHtml(html);
    expect(rendered).toContain('<iframe');
    expect(rendered).toContain('https://www.youtube.com/embed/abc123');
  });

  it('renders video nodes as iframe', () => {
    const rendered = tiptapJsonToHtml({
      type: 'video',
      attrs: { src: 'https://www.tiktok.com/@user/video/1234567890' },
    } as any);
    expect(rendered).toContain('tiktok.com/embed/v2/1234567890');
    expect(rendered).toContain('padding-top:300%');
    expect(rendered).toContain('min-height:120vh');
  });
});
