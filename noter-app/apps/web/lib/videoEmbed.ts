export const resolveEmbedBaseUrl = (baseOverride?: string) => {
  if (baseOverride) return baseOverride.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'https://daylited.com/app';
  if (window.location.protocol === 'file:') return 'https://daylited.com/app';
  const basePath = window.location.pathname.startsWith('/app') ? '/app' : '';
  return `${window.location.origin}${basePath}`;
};

export const getTikTokEmbedUrl = (url: string) => {
  if (!url) return null;
  if (url.includes('embed/v2/')) return url;
  const match = url.match(/video\/(\d+)/);
  if (match && match[1]) {
    return `https://www.tiktok.com/embed/v2/${match[1]}`;
  }
  return null;
};

export const getYouTubeEmbedUrl = (url: string, baseOverride?: string) => {
  if (!url) return null;
  if (url.includes('/embed/')) return url;
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const idFromQuery = url.includes('v=') ? url.split('v=')[1]?.split('&')[0] : null;
    const idFromPath = url.split('/').pop()?.split('?')[0] || null;
    const videoId = idFromQuery || idFromPath;
    if (videoId) {
      const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
      const isElectron = typeof window !== 'undefined' && Boolean((window as any).mlc?.isElectron);
      if (isFileProtocol || isElectron) {
        return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1&playsinline=1`;
      }
      return `${resolveEmbedBaseUrl(baseOverride)}/embed/youtube?id=${encodeURIComponent(videoId)}`;
    }
  }
  return null;
};

export const resolveVideoEmbedUrl = (url: string, baseOverride?: string) => {
  const tikTokEmbed = getTikTokEmbedUrl(url);
  if (tikTokEmbed) return tikTokEmbed;
  const youtubeEmbed = getYouTubeEmbedUrl(url, baseOverride);
  if (youtubeEmbed) return youtubeEmbed;
  return url;
};
