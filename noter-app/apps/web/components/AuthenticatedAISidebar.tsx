 'use client';

import React from 'react';
import { useStore } from '../stores/useStore';
import { AISidebar } from './AISidebar';

export default function AuthenticatedAISidebar() {
  const { user, isHydrated } = useStore();
  if (!isHydrated || !user) return null;
  return <AISidebar />;
}
