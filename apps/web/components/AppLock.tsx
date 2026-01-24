'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { FaLock } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export default function AppLock() {
    const { isAppLocked, setAppLocked, user, login } = useStore();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [mounted, setMounted] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const { t } = useTranslation();

    useEffect(() => {
        setMounted(true);
    }, []);

    const resetTimer = useCallback(() => {
        if (isAppLocked || !user) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            setAppLocked(true);
        }, TIMEOUT_MS);
    }, [isAppLocked, setAppLocked, user]);

    useEffect(() => {
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        const handleActivity = () => resetTimer();

        if (user) {
            events.forEach(event => window.addEventListener(event, handleActivity));
            resetTimer();
        }

        return () => {
            events.forEach(event => window.removeEventListener(event, handleActivity));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [resetTimer, user]);

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        
        try {
            await login(user.username, password);
            setAppLocked(false);
            setPassword('');
            setError('');
            resetTimer();
        } catch (err) {
            setError(t('appLock.incorrectPassword'));
        }
    };

    if (!isAppLocked || !mounted) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-gray-900 flex flex-col items-center justify-center text-white">
            <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md text-center">
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
