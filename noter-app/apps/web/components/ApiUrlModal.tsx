'use client';

import React from 'react';
import { getApiBaseUrl, setApiBaseUrl } from '../services/api';
import { useTranslation } from 'react-i18next';

interface ApiUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ApiUrlModal({ isOpen, onClose }: ApiUrlModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!isOpen) return;
    setValue(getApiBaseUrl());
    setError('');
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('settings.apiBaseUrl')}</h2>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        <div className="mt-4">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('settings.apiBaseUrlPlaceholder')}
            className="w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            autoFocus
          />
          <div className="mt-2 text-xs text-gray-500">{t('settings.apiBaseUrlHint')}</div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
          <button
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => {
              if (!value.trim()) {
                setError(t('settings.apiBaseUrlRequired'));
                return;
              }
              setApiBaseUrl(value);
              onClose();
            }}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
