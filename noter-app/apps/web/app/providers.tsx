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
  const language = useStore((state) => state.language)
  const isAppLocked = useStore((state) => state.isAppLocked)

  useEffect(() => {
    i18n.changeLanguage(language)
  }, [language])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mlc = (window as any).mlc
    const root = document.documentElement
    const isElectronShell = Boolean(mlc?.isElectron)
    const isMacShell = Boolean(mlc?.isMac || mlc?.platform === 'darwin')
    const isAppleSiliconShell = Boolean(mlc?.isAppleSilicon || (mlc?.platform === 'darwin' && mlc?.arch === 'arm64'))
    root.classList.toggle('electron-shell', isElectronShell)
    root.classList.toggle('platform-mac', isMacShell)
    root.classList.toggle('apple-silicon', isAppleSiliconShell)
    return () => {
      root.classList.remove('electron-shell', 'platform-mac', 'apple-silicon')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return
    ;(window as any).__NOTER_E2E__ = {
      getState: () => useStore.getState(),
      setState: (partial: Record<string, unknown>) => useStore.setState(partial as any),
      fetchNotes: () => useStore.getState().fetchNotes(),
      fetchTasks: (parentNoteId?: string) => useStore.getState().fetchTasks(parentNoteId),
      createNote: async (title: string, _content = '', parentId: string | null = null, type: 'note' | 'project' | 'task_list' = 'note') => {
        const beforeIds = new Set(useStore.getState().notes.map((note) => note._id))
        await useStore.getState().createNote(title, parentId, type)
        return useStore.getState().notes.find((note) => !beforeIds.has(note._id)) ?? null
      },
      updateNote: (id: string, data: Record<string, unknown>) =>
        useStore.getState().updateNote(id, data as any),
      createTask: async (title: string, parentNoteId?: string | null) => {
        const beforeIds = new Set(useStore.getState().tasks.map((task) => task._id))
        await useStore.getState().createTask(title, parentNoteId || undefined)
        return useStore.getState().tasks.find((task) => !beforeIds.has(task._id)) ?? null
      },
      deleteNote: (id: string) => useStore.getState().deleteNote(id),
      deleteTask: (id: string) => useStore.getState().deleteTask(id),
      updateTask: (id: string, data: Record<string, unknown>) =>
        useStore.getState().updateTask(id, data as any),
      unlockNote: (id: string, password: string) => useStore.getState().unlockNote(id, password),
      selectNote: (id: string | null) => useStore.getState().selectNote(id),
      setActiveProject: (id: string | null) => useStore.getState().setActiveProject(id),
      hydrate: () => useStore.getState().hydrate(),
    }
    return () => {
      delete (window as any).__NOTER_E2E__
    }
  }, [])

  return (
    React.createElement(
      DndProvider as any,
      { backend: HTML5Backend },
      (
        <ThemeProvider attribute="class">
          <I18nextProvider i18n={i18n}>
            <AppLock />
            {!isAppLocked && children}
          </I18nextProvider>
        </ThemeProvider>
      )
    )
  )
}
