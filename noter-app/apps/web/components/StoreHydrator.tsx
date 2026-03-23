'use client';

import { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { initWebEncryptionKey } from '../services/encryptionKey';

export default function StoreHydrator() {
  const { hydrate } = useStore();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initWebEncryptionKey();
      if (!cancelled) hydrate();
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  return null;
}
