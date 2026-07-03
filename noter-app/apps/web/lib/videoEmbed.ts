import { resolveVideoEmbed } from '@repo/shared';

/**
 * Web-specific video-embed URL resolution on top of the shared parser
 * (@repo/shared/videoEmbed). The shared module owns URL validation and
 * provider parsing; this file only decides WHERE YouTube embeds load from:
 * on the hosted web app they go through our same-origin relay page
 * (/embed/youtube) so the note view never talks to Google directly, while
 * Electron/file builds embed straight from youtube.com.
 */

export const resolveEmbedBaseUrl = (baseOverride?: string) => {
  if (baseOverride) return baseOverride.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'https://daylited.com/app';
  if (window.location.protocol === 'file:') return 'https://daylited.com/app';
  const basePath = window.location.pathname.startsWith('/app') ? '/app' : '';
  return `${window.location.origin}${basePath}`;
};

export const getTikTokEmbedUrl = (url: string): string | null => {
  const resolved = resolveVideoEmbed(url);
  return resolved?.provider === 'tiktok' ? resolved.embedUrl : null;
};

export const getYouTubeEmbedUrl = (url: string, baseOverride?: string): string | null => {
  const resolved = resolveVideoEmbed(url);
  if (resolved?.provider !== 'youtube' || !resolved.videoId) return null;
  const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).mlc?.isElectron);
  if (isFileProtocol || isElectron) return resolved.embedUrl;
  return `${resolveEmbedBaseUrl(baseOverride)}/embed/youtube?id=${encodeURIComponent(resolved.videoId)}`;
};

/**
 * Resolve any pasted URL to an iframe-safe embed URL. Unknown-but-valid http(s)
 * URLs pass through normalized (generic embeds like Spotify/Loom); invalid or
 * non-http input resolves to '' so it can never reach an iframe src.
 */
export const resolveVideoEmbedUrl = (url: string, baseOverride?: string): string => {
  const resolved = resolveVideoEmbed(url);
  if (!resolved) return '';
  if (resolved.provider === 'youtube') return getYouTubeEmbedUrl(url, baseOverride) ?? resolved.embedUrl;
  return resolved.embedUrl;
};
