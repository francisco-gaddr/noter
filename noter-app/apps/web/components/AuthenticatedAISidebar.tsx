 'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useStore } from '../stores/useStore';

const AISidebar = dynamic(() => import('./AISidebar').then((mod) => mod.AISidebar), {
  ssr: false,
  loading: () => null,
});

export default function AuthenticatedAISidebar() {
  const user = useStore((state) => state.user);
  const isHydrated = useStore((state) => state.isHydrated);
  const [shouldRenderSidebar, setShouldRenderSidebar] = React.useState(false);

  React.useEffect(() => {
    if (!isHydrated || !user) {
      setShouldRenderSidebar(false);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleCallbackId: number | null = null;
    const activate = () => setShouldRenderSidebar(true);

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleCallbackId = (window as any).requestIdleCallback(activate, { timeout: 700 });
    } else {
      timeoutId = globalThis.setTimeout(activate, 180);
    }

    return () => {
      if (idleCallbackId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        (window as any).cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, [isHydrated, user?._id]);

  if (!isHydrated || !user || !shouldRenderSidebar) return null;
  return <AISidebar />;
}
