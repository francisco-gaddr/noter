'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Navbar from '../components/Navbar';
import SidebarTree from '../components/SidebarTree';
import Auth from '../components/Auth';
import { useStore } from '../stores/useStore';
import { loadHotkeys, matchesHotkey } from '../lib/hotkeys';

const AppLoadingShell = ({ timedOut }: { timedOut: boolean }) => (
  <main
    role="main"
    className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-gray-900 dark:bg-gray-900 dark:text-gray-100"
  >
    <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500 dark:border-gray-700 dark:border-t-blue-400" />
      <h1 className="text-xl font-semibold">Laddar Noter…</h1>
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
        Förbereder kryptering, lokal data och användarsession.
      </p>
      {timedOut ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Starten tar längre tid än väntat. Försök ladda om om appen inte fortsätter inom kort.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Ladda om
          </button>
        </div>
      ) : null}
    </div>
  </main>
);

const ContentLoadingShell = () => (
  <div className="flex h-full items-center justify-center bg-white px-6 text-center text-gray-600 dark:bg-gray-900 dark:text-gray-300">
    <div className="max-w-sm">
      <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500 dark:border-gray-700 dark:border-t-blue-400" />
      <p className="text-sm">Laddar vy…</p>
    </div>
  </div>
);

const NoteEditor = dynamic(() => import('../components/NoteEditor'), {
  ssr: false,
  loading: () => <ContentLoadingShell />,
});

const TaskList = dynamic(() => import('../components/TaskList'), {
  ssr: false,
  loading: () => <ContentLoadingShell />,
});

export default function Home() {
  const initSocket = useStore((state) => state.initSocket);
  const user = useStore((state) => state.user);
  const activeTab = useStore((state) => state.activeTab);
  const isHydrated = useStore((state) => state.isHydrated);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizing, setIsResizing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isSplitResizing, setIsSplitResizing] = useState(false);
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);
  const sidebarWidthRef = useRef(256);
  const splitRatioRef = useRef(0.5);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const splitResizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    splitRatioRef.current = splitRatio;
  }, [splitRatio]);

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem('sidebarWidth', sidebarWidthRef.current.toString());
  }, []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(150, Math.min(mouseMoveEvent.clientX, 600));
      if (sidebarResizeFrameRef.current !== null) {
        cancelAnimationFrame(sidebarResizeFrameRef.current);
      }
      sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
        sidebarWidthRef.current = newWidth;
        setSidebarWidth((prev) => (prev === newWidth ? prev : newWidth));
        sidebarResizeFrameRef.current = null;
      });
    },
    [isResizing]
  );

  useEffect(() => {
    setMounted(true);
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
      setSidebarWidth(parseInt(savedWidth, 10));
    }
    const savedCollapsed = localStorage.getItem('sidebarCollapsed');
    if (savedCollapsed) {
      setIsSidebarCollapsed(savedCollapsed === 'true');
    }
    const savedSplit = localStorage.getItem('splitViewEnabled');
    if (savedSplit) {
      setIsSplitView(savedSplit === 'true');
    }
    const savedSplitRatio = localStorage.getItem('splitViewRatio');
    if (savedSplitRatio) {
      const parsed = Number(savedSplitRatio);
      if (!Number.isNaN(parsed) && parsed > 0.2 && parsed < 0.8) {
        setSplitRatio(parsed);
      }
    }
    if (user) {
        initSocket();
    }
  }, [initSocket, user]);

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      if (sidebarResizeFrameRef.current !== null) {
        cancelAnimationFrame(sidebarResizeFrameRef.current);
      }
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hotkeys = loadHotkeys();
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const el = target;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.getAttribute('contenteditable') === 'true') return true;
      return Boolean(el.closest('[contenteditable="true"]'));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (matchesHotkey(event, hotkeys.toggleAiSidebar)) {
        event.preventDefault();
        window.dispatchEvent(new Event('ai-sidebar-toggle'));
        return;
      }
      if (matchesHotkey(event, hotkeys.toggleSplitView)) {
        event.preventDefault();
        setIsSplitView((prev) => {
          const next = !prev;
          localStorage.setItem('splitViewEnabled', String(next));
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!mounted || isHydrated) {
      setHydrationTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setHydrationTimedOut(true);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [isHydrated, mounted]);

  useEffect(() => {
    if (!isSplitResizing) return;
    const onMove = (event: MouseEvent) => {
      const el = document.getElementById('split-main-content');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = Math.max(0.25, Math.min((event.clientX - rect.left) / rect.width, 0.75));
      if (splitResizeFrameRef.current !== null) {
        cancelAnimationFrame(splitResizeFrameRef.current);
      }
      splitResizeFrameRef.current = window.requestAnimationFrame(() => {
        splitRatioRef.current = next;
        setSplitRatio((prev) => (prev === next ? prev : next));
        splitResizeFrameRef.current = null;
      });
    };
    const onUp = () => {
      setIsSplitResizing(false);
      localStorage.setItem('splitViewRatio', String(splitRatioRef.current));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (splitResizeFrameRef.current !== null) {
        cancelAnimationFrame(splitResizeFrameRef.current);
      }
    };
  }, [isSplitResizing]);

  const toggleSidebar = useCallback(() => {
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    localStorage.setItem('sidebarCollapsed', String(next));
  }, [isSidebarCollapsed]);

  if (!mounted || !isHydrated) {
    return <AppLoadingShell timedOut={hydrationTimedOut} />;
  }

  if (!user) {
    return (
      <main role="main">
        <h1 className="sr-only">Noter</h1>
        <Auth />
      </main>
    );
  }

  return (
    <div
      className="flex flex-col h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-300"
    >
      <header role="banner">
        <Navbar
          onToggleSidebar={toggleSidebar}
          isSidebarCollapsed={isSidebarCollapsed}
        />
      </header>
      <div className="flex flex-1 overflow-hidden">
        <nav 
            className="relative flex-shrink-0 overflow-hidden flex flex-col"
            style={{ width: isSidebarCollapsed ? 0 : sidebarWidth }}
            aria-label="Huvudnavigering"
            role="navigation"
        >
          {!isSidebarCollapsed && (
            <>
              <SidebarTree />
              <div
                className={`absolute top-0 right-0 w-1 h-full cursor-col-resize bg-gray-200 dark:bg-gray-700 hover:bg-blue-500 transition-colors z-10 ${isResizing ? 'bg-blue-500' : ''}`}
                onMouseDown={startResizing}
                role="separator"
                aria-orientation="vertical"
                aria-label="Ändra sidopanelbredd"
                aria-valuenow={sidebarWidth}
                aria-valuemin={200}
                aria-valuemax={600}
                tabIndex={0}
              />
            </>
          )}
        </nav>

        <main className="flex-1 overflow-hidden bg-white dark:bg-gray-900" role="main" id="main-content">
          <h1 className="sr-only">Noter Innehåll</h1>
          {isSplitView ? (
            <div className="h-full flex" id="split-main-content" data-testid="split-main-content">
              <section
                className="h-full overflow-hidden min-w-0"
                style={{ width: `${splitRatio * 100}%` }}
                aria-label="Anteckningsvy"
                data-testid="split-notes-pane"
              >
                <NoteEditor />
              </section>
              <div
                className={`w-1 h-full cursor-col-resize bg-gray-200 dark:bg-gray-700 hover:bg-blue-500 transition-colors ${isSplitResizing ? 'bg-blue-500' : ''}`}
                onMouseDown={() => setIsSplitResizing(true)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Ändra split-vy bredd"
                tabIndex={0}
                data-testid="split-divider"
              />
              <section
                className="h-full overflow-hidden min-w-0"
                style={{ width: `${(1 - splitRatio) * 100}%` }}
                aria-label="Uppgiftsvy"
                data-testid="split-tasks-pane"
              >
                <TaskList />
              </section>
            </div>
          ) : activeTab === 'tasks' ? (
            <TaskList />
          ) : (
            <NoteEditor />
          )}
        </main>
      </div>
    </div>
  );
}
