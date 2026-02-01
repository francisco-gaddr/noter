'use client';

import { useEffect } from 'react';
import { useStore } from '../stores/useStore';

export default function StoreHydrator() {
  const { hydrate } = useStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return null;
}
