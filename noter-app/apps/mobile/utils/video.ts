import { resolveVideoEmbed, buildVideoEmbedHtml } from '@repo/shared';

/**
 * Thin wrappers around the shared video-embed resolver (@repo/shared/videoEmbed).
 * The shared module owns URL validation, provider parsing (YouTube/Vimeo/TikTok/
 * direct files) and HTML escaping/sandboxing — nothing here may interpolate raw
 * user input into HTML.
 */

export const getVideoEmbedUrl = (url: string): string => resolveVideoEmbed(url)?.embedUrl ?? '';

export const getVideoEmbedHtml = (url: string): string => buildVideoEmbedHtml(url);
