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
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

export default function Home() {
  const { initSocket, user, activeTab, isHydrated } = useStore();
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizing, setIsResizing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const startResizing = useCallback(() => {
    if (isSidebarCollapsed) return;
    setIsResizing(true);
  }, [isSidebarCollapsed]);

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
      setIsSidebarCollapsed(savedCollapsed === '1');
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
        role="region"
        aria-label="Noter"
      >
        <Navbar />
        <div className="relative flex flex-1 overflow-hidden">
          <aside 
              className="relative flex-shrink-0 overflow-hidden flex flex-col"
              style={{ width: isSidebarCollapsed ? 0 : sidebarWidth }}
              aria-label="Sidopanel"
              aria-hidden={isSidebarCollapsed}
          >
            {!isSidebarCollapsed && (
              <button
                type="button"
                onClick={() => {
                  setIsSidebarCollapsed(true);
                  localStorage.setItem('sidebarCollapsed', '1');
                  setIsResizing(false);
                }}
                className="absolute top-2 right-2 z-20 p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                aria-label="Fäll in sidopanel"
                title="Fäll in sidopanel"
              >
                <FaChevronLeft aria-hidden="true" />
              </button>
            )}
            <SidebarTree />
            <div
              className={`absolute top-0 right-0 w-1 h-full cursor-col-resize bg-gray-200 dark:bg-gray-700 hover:bg-blue-500 transition-colors z-10 ${isResizing ? 'bg-blue-500' : ''}`}
              onMouseDown={startResizing}
              role="separator"
              aria-orientation="vertical"
              aria-label="Ändra sidopanelbredd"
              tabIndex={0}
            />
          </aside>

          {isSidebarCollapsed && (
            <button
              type="button"
              onClick={() => {
                setIsSidebarCollapsed(false);
                localStorage.setItem('sidebarCollapsed', '0');
              }}
              className="absolute left-0 top-20 z-20 p-2 rounded-r hover:bg-gray-200 dark:hover:bg-gray-800 bg-gray-100/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 border border-l-0 border-gray-200 dark:border-gray-700"
              aria-label="Fäll ut sidopanel"
              title="Fäll ut sidopanel"
            >
              <FaChevronRight aria-hidden="true" />
            </button>
          )}

          <main className="flex-1 overflow-hidden bg-white dark:bg-gray-900" role="main">
            <h1 className="sr-only">Noter</h1>
            {activeTab === 'tasks' ? (
              <TaskList />
            ) : (
              <>
                <NoteEditor />
              </>
            )}
          </main>
        </div>
      </div>
    </DndProvider>
  );
}
