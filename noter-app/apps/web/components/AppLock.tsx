'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { shouldRelockOnIdle } from '@repo/shared';
import { FaLock, FaSignOutAlt } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

export default function AppLock() {
    const { isAppLocked, setAppLocked, user, login, logout, autoLockTimeout, verifyAppLockPassword, relockProtectedFolders } = useStore();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [mounted, setMounted] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const lastActivityRef = useRef<number>(Date.now());
    const { t } = useTranslation();

    useEffect(() => {
        setMounted(true);
    }, []);

    const resetTimer = useCallback(() => {
        if (isAppLocked || !user) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        const timeoutMs = (autoLockTimeout || 15) * 60 * 1000;
        timerRef.current = setTimeout(() => {
            setAppLocked(true);
        }, timeoutMs);
    }, [isAppLocked, setAppLocked, user, autoLockTimeout]);

    useEffect(() => {
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        const handleActivity = () => {
            lastActivityRef.current = Date.now();
            resetTimer();
        };

        if (user) {
            events.forEach(event => window.addEventListener(event, handleActivity));
            lastActivityRef.current = Date.now();
            resetTimer();
        }

        return () => {
            events.forEach(event => window.removeEventListener(event, handleActivity));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [resetTimer, user]);

    // FOREGROUND idle re-lock: while the app stays open, re-lock the sensitive protected folders
    // after a short window of inactivity (shouldRelockOnIdle / FOLDER_IDLE_RELOCK_MS in @repo/shared),
    // independent of the longer whole-app lock above. Polled every 30s; relockProtectedFolders is a
    // no-op when nothing is unlocked. See docs/LOCKED_FOLDER_SECURITY.md §2.
    useEffect(() => {
        if (!user) return;
        const id = setInterval(() => {
            if (shouldRelockOnIdle(lastActivityRef.current, Date.now())) relockProtectedFolders();
        }, 30 * 1000);
        return () => clearInterval(id);
    }, [user, relockProtectedFolders]);

    // Re-lock every password-protected folder when the tab/window is hidden (tab switch,
    // minimise, OS app switch). A locked folder is the most sensitive surface, so leaving the
    // app closes it without forcing a whole-app re-auth — parity with the mobile background
    // re-lock. No-op when nothing is unlocked. See docs/LOCKED_FOLDER_SECURITY.md §2.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') relockProtectedFolders();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [relockProtectedFolders]);

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Try local hash verification first (supports offline)
        if (verifyAppLockPassword(password)) {
            setAppLocked(false);
            setPassword('');
            setError('');
            resetTimer();
            return;
        }

        if (!user) {
            setError(t('appLock.incorrectPassword'));
            return;
        }
        
        try {
            await login(user.username, password);
            setAppLocked(false);
            setPassword('');
            setError('');
            resetTimer();
        } catch (err: any) {
            console.error('Unlock failed:', err);
            if (err.message === 'Unauthorized' || err.message === 'Invalid password') {
                setError(t('appLock.incorrectPassword'));
            } else {
                setError(err.message || t('errors.generic'));
            }
        }
    };

    if (!isAppLocked || !mounted) return null;

    return (
        <div role="main" aria-label="App Lock" className="fixed inset-0 z-[100] bg-gray-900 flex flex-col items-center justify-center text-white">
            <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md text-center relative">
                <button
                    type="button"
                    onClick={logout}
                    aria-label={t('navbar.logout')}
                    className="absolute left-3 top-3 p-2 rounded hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                >
                    <FaSignOutAlt size={14} />
                </button>
                <div className="mb-6 flex justify-center">
                    <div className="p-4 bg-blue-600 rounded-full">
                        <FaLock size={48} />
                    </div>
                </div>
                <h2 className="text-2xl font-bold mb-2">{t('appLock.title')}</h2>
                <p className="text-gray-400 mb-6">{t('appLock.subtitle')}</p>
                
                <form onSubmit={handleUnlock} className="space-y-4">
                    <div>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('appLock.passwordPlaceholder')}
                            className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none text-white"
                            autoFocus
                        />
                    </div>
                    {error && <p className="text-red-500 text-sm">{error}</p>}
                    <button
                        type="submit"
                        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 rounded font-bold transition-colors"
                    >
                        {t('appLock.unlock')}
                    </button>
                </form>
            </div>
        </div>
    );
}
