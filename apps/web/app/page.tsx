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

export default function Home() {
  const { initSocket, user, activeTab, isHydrated } = useStore();
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizing, setIsResizing] = useState(false);
  const [mounted, setMounted] = useState(false);

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
    [isResizing]
  );

  useEffect(() => {
    setMounted(true);
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
      setSidebarWidth(parseInt(savedWidth, 10));
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
        <div className="flex flex-1 overflow-hidden">
          <aside 
              className="relative flex-shrink-0 overflow-hidden flex flex-col"
              style={{ width: sidebarWidth }}
              aria-label="Sidopanel"
          >
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
