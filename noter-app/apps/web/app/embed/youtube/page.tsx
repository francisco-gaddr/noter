'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const buildEmbedUrl = (id: string) =>
  `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;

function YouTubeEmbedContent() {
  const params = useSearchParams();
  const rawId = params?.get('id') || '';
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const src = id ? buildEmbedUrl(id) : '';

  return (
    <div style={{ margin: 0, background: '#000', width: '100vw', height: '100vh' }}>
      {src ? (
        <iframe
          src={src}
          style={{ width: '100vw', height: '100vh', border: 0 }}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="origin-when-cross-origin"
        />
      ) : null}
    </div>
  );
}

export default function YouTubeEmbedPage() {
  return (
    <Suspense fallback={<div style={{ margin: 0, background: '#000', width: '100vw', height: '100vh' }} />}>
      <YouTubeEmbedContent />
    </Suspense>
  );
}
