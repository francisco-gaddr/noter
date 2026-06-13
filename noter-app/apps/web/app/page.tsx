'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import SidebarTree from '../components/SidebarTree';
import NoteEditor from '../components/NoteEditor';
import TaskList from '../components/TaskList';
import Auth from '../components/Auth';
import { useStore } from '../stores/useStore';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { loadHotkeys, matchesHotkey } from '../lib/hotkeys';
import { restoreCryptoFromSession } from '../lib/crypto';

export default function Home() {
  const { initSocket, user, activeTab, isHydrated } = useStore();
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizing, setIsResizing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isSplitResizing, setIsSplitResizing] = useState(false);

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem('sidebarWidth', sidebarWidth.toString());
  }, [sidebarWidth]);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = Math.max(150, Math.min(mouseMoveEvent.clientX, 600));
        setSidebarWidth(newWidth);
      }
    },
    [isResizing, setSidebarWidth]
  );

  useEffect(() => {
    setMounted(true);
    // Re-activate v3 E2E from the per-tab session key (if enrolled) before data
    // loads, so v3-encrypted notes decrypt on first render. No-op otherwise.
    void restoreCryptoFromSession().catch(() => undefined);
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
    if (!isSplitResizing) return;
    const onMove = (event: MouseEvent) => {
      const el = document.getElementById('split-main-content');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = Math.max(0.25, Math.min((event.clientX - rect.left) / rect.width, 0.75));
      setSplitRatio(next);
      localStorage.setItem('splitViewRatio', String(next));
    };
    const onUp = () => setIsSplitResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isSplitResizing]);

  if (!mounted || !isHydrated) {
    return null;
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
    <DndProvider backend={HTML5Backend}>
      <div
        className="flex flex-col h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-300"
      >
        <header role="banner">
          <Navbar
            onToggleSidebar={() => {
              const next = !isSidebarCollapsed;
              setIsSidebarCollapsed(next);
              localStorage.setItem('sidebarCollapsed', String(next));
            }}
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
    </DndProvider>
  );
}
