'use client';

import React from 'react';
import { useStore } from '../stores/useStore';
import { useTranslation } from 'react-i18next';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { language, setLanguage } = useStore();
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{t('settings.title')}</h2>
        
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
            {t('common.language')}
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'sv' | 'en')}
            aria-label={t('common.language')}
            className="w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="sv">Svenska</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
