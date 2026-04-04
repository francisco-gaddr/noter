'use client';

import { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { initWebEncryptionKey } from '../services/encryptionKey';

export default function StoreHydrator() {
  const hydrate = useStore((state) => state.hydrate);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initWebEncryptionKey();
      } catch (error) {
        console.error('Failed to initialize web encryption key', error);
      }
      if (!cancelled) hydrate();
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  return null;
}
