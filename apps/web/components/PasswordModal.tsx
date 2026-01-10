import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  title?: string;
  isCreatingLock?: boolean;
}

export const PasswordModal: React.FC<PasswordModalProps> = ({ 
  isOpen, 
  onClose, 
  onSubmit, 
  title,
  isCreatingLock = false
}) => {
  const { t } = useTranslation();

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError(t('passwordModal.passwordRequired'));
      return;
    }
    
    setLoading(true);
    setError('');
    try {
      await onSubmit(password);
      setPassword('');
      onClose();
    } catch (err) {
      setError(t('passwordModal.incorrectOrError'));
    } finally {
      setLoading(false);
    }
  };

  const modalTitle = title ?? t('passwordModal.titleEnter');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-sm">
        <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">{modalTitle}</h3>
        
        {isCreatingLock && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t('passwordModal.hintCreate')}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 border rounded mb-4 dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={isCreatingLock ? t('passwordModal.placeholderCreate') : t('passwordModal.placeholderEnter')}
            autoFocus
          />
          
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { onClose(); setPassword(''); setError(''); }}
              className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? t('common.processing') : (isCreatingLock ? t('passwordModal.lockButton') : t('passwordModal.unlockButton'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
