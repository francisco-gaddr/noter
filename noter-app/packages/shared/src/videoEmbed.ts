/**
 * Video-embed resolution shared by web + mobile note editors.
 *
 * SECURITY: the resolved `embedUrl` is the ONLY thing that may reach an
 * iframe/video `src`. It is always produced from a parsed `new URL(...)`
 * (never the raw input string), so scheme smuggling (`javascript:`) and
 * attribute breakouts (`" onload=...`) can't survive resolution. HTML built
 * here additionally attribute-escapes the URL and sandboxes the iframe.
 */

export type VideoProvider = 'youtube' | 'vimeo' | 'tiktok' | 'file' | 'generic';

export interface ResolvedVideoEmbed {
  provider: VideoProvider;
  /** Canonical http(s) URL, safe for an iframe/video `src` (still escape when inlining into HTML). */
  embedUrl: string;
  videoId?: string;
}

export const escapeHtmlAttr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const YOUTUBE_ID = /^[A-Za-z0-9_-]{5,20}$/;
const DIGITS = /^\d{1,25}$/;
const VIDEO_FILE = /\.(mp4|webm|ogv|ogg|m4v|mov)$/i;

const parseHttpUrl = (raw: string): URL | null => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
};

const hostMatches = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

export const YOUTUBE_EMBED_PARAMS = 'rel=0&modestbranding=1&playsinline=1';

export const buildYouTubeEmbedUrl = (videoId: string): string =>
  `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${YOUTUBE_EMBED_PARAMS}`;

/**
 * Parse any user-pasted video URL into a canonical embed target.
 * Returns null when the input is not a valid http(s) URL at all.
 */
export const resolveVideoEmbed = (raw: string): ResolvedVideoEmbed | null => {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (hostMatches(host, 'youtube.com') || hostMatches(host, 'youtube-nocookie.com') || host === 'youtu.be') {
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = segments[0] ?? null;
    } else if (url.searchParams.get('v')) {
      id = url.searchParams.get('v');
    } else if (['shorts', 'live', 'embed', 'v'].includes(segments[0] ?? '')) {
      id = segments[1] ?? null;
    }
    if (id && YOUTUBE_ID.test(id)) {
      return { provider: 'youtube', videoId: id, embedUrl: buildYouTubeEmbedUrl(id) };
    }
    return null;
  }

  if (hostMatches(host, 'vimeo.com')) {
    const id = host === 'player.vimeo.com'
      ? (segments[0] === 'video' ? segments[1] : undefined)
      : segments.find((s) => DIGITS.test(s));
    if (id && DIGITS.test(id)) {
      return { provider: 'vimeo', videoId: id, embedUrl: `https://player.vimeo.com/video/${id}` };
    }
    return null;
  }

  if (hostMatches(host, 'tiktok.com')) {
    const match = url.pathname.match(/\/video\/(\d+)/) || url.pathname.match(/\/embed\/v2\/(\d+)/);
    const id = match?.[1];
    if (id && DIGITS.test(id)) {
      return { provider: 'tiktok', videoId: id, embedUrl: `https://www.tiktok.com/embed/v2/${id}` };
    }
    return null;
  }

  if (VIDEO_FILE.test(url.pathname)) {
    return { provider: 'file', embedUrl: url.toString() };
  }

  // Anything else that parses as http(s) is allowed as a generic embed
  // (Spotify, Loom, …) — normalized through URL so it can't smuggle markup.
  return { provider: 'generic', embedUrl: url.toString() };
};

/**
 * Self-contained embed HTML for WebView-based editors (mobile rich editor).
 * Escaped src + sandboxed iframe; direct video files get a native <video> tag.
 */
export const buildVideoEmbedHtml = (raw: string): string => {
  const resolved = resolveVideoEmbed(raw);
  if (!resolved) return '';
  const src = escapeHtmlAttr(resolved.embedUrl);
  if (resolved.provider === 'file') {
    return `<div style="width:100%;"><video controls playsinline preload="metadata" style="width:100%;max-height:70vh;background:#000;" src="${src}"></video></div><br/>`;
  }
  const isTikTok = resolved.provider === 'tiktok';
  const ratio = isTikTok ? '300%' : '56.25%';
  const minHeight = isTikTok ? '120vh' : '0';
  return (
    `<div style="position:relative;width:100%;padding-top:${ratio};min-height:${minHeight};overflow:hidden;">` +
    `<iframe src="${src}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
    `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" ` +
    `style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" scrolling="no" ` +
    `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div><br/>`
  );
};
