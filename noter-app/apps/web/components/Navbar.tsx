'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { FaMoon, FaSun, FaSearch, FaSignOutAlt, FaCog, FaIndent } from 'react-icons/fa';
import { useStore } from '../stores/useStore';
import SettingsModal from './SettingsModal';
import { useTranslation } from 'react-i18next';

export default function Navbar({ onToggleSidebar, isSidebarCollapsed }: { onToggleSidebar?: () => void; isSidebarCollapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { searchQuery, setSearchQuery, logout, user, activeTab } = useStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <nav className="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-white dark:bg-gray-900" aria-label={t('navbar.topNav')}>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          title={isSidebarCollapsed ? t('navbar.showSidebar') : t('navbar.hideSidebar')}
          aria-label={isSidebarCollapsed ? t('navbar.showSidebar') : t('navbar.hideSidebar')}
        >
          <FaIndent aria-hidden="true" />
        </button>
        <div className="font-bold text-xl" aria-label={t('navbar.appTitle')}>Noter</div>
      </div>
      <div className="flex items-center gap-4 flex-1 justify-center max-w-xl mx-auto">
        <div className="relative w-full">
          <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-600 dark:text-gray-300" aria-hidden="true" />
          <input
            type="text"
            placeholder={activeTab === 'tasks' ? t('navbar.searchPlaceholderTasks') : t('navbar.searchPlaceholderNotes')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label={activeTab === 'tasks' ? t('navbar.searchAriaTasks') : t('navbar.searchAriaNotes')}
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        {user && (
            <div className="text-sm mr-2 hidden md:block font-medium">
                {user.username}
            </div>
        )}
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t('navbar.settingsTitle')}
          aria-label={t('navbar.openSettings')}
        >
          <FaCog aria-hidden="true" />
        </button>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t('navbar.toggleTheme')}
          aria-label={t('navbar.toggleTheme')}
        >
          {theme === 'dark' ? <FaSun aria-hidden="true" /> : <FaMoon aria-hidden="true" />}
        </button>
        <button
            onClick={logout}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-red-500"
            title={t('navbar.logout')}
            aria-label={t('navbar.logout')}
        >
            <FaSignOutAlt aria-hidden="true" />
        </button>
      </div>
      {isSettingsOpen && (
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      )}
    </nav>
  );
}
