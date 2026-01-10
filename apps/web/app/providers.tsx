'use client'

import React, { useEffect } from 'react'
import { ThemeProvider } from 'next-themes'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'
import { useStore } from '../stores/useStore'
import AppLock from '../components/AppLock'

// Initialize axe-core accessibility checks in development
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const axe = require('@axe-core/react');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactDOM = require('react-dom');
    axe(React, ReactDOM, 1000);
    // axe will log issues to console. We can later wire a reporter.
  } catch (e) {
    // ignore if axe is not available
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const { language } = useStore()

  useEffect(() => {
    i18n.changeLanguage(language)
  }, [language])

  return (
    React.createElement(
      DndProvider as any,
      { backend: HTML5Backend },
      (
        <ThemeProvider attribute="class">
          <I18nextProvider i18n={i18n}>
            <AppLock />
            {children}
          </I18nextProvider>
        </ThemeProvider>
      )
    )
  )
}
