export const normalizeVideoUrl = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const buildYouTubeEmbedUrl = (id: string) =>
  `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;

export const getVideoEmbedUrl = (url: string) => {
  const input = normalizeVideoUrl(url);
  if (!input) return '';
  if (input.includes('youtube.com') || input.includes('youtu.be')) {
    const idFromQuery = input.includes('v=') ? input.split('v=')[1]?.split('&')[0] : null;
    const idFromPath = input.split('/').pop()?.split('?')[0] || null;
    const videoId = idFromQuery || idFromPath;
    return videoId ? buildYouTubeEmbedUrl(encodeURIComponent(videoId)) : input;
  }
  if (input.includes('tiktok.com')) {
    if (input.includes('embed/v2/')) return input;
    const match = input.match(/video\/(\d+)/);
    const videoId = match?.[1];
    return videoId ? `https://www.tiktok.com/embed/v2/${videoId}` : input;
  }
  return input;
};

export const getVideoEmbedHtml = (url: string) => {
  const embedUrl = getVideoEmbedUrl(url);
  if (!embedUrl) return '';
  const isTikTok = embedUrl.includes('tiktok.com/embed');
  const ratio = isTikTok ? '300%' : '56.25%';
  const minHeight = isTikTok ? '120vh' : '0';
  return `<div style="position:relative;width:100%;padding-top:${ratio};min-height:${minHeight};overflow:hidden;"><iframe src="${embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" scrolling="no" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div><br/>`;
};
