'use client';

import React from 'react';
import { useStore } from '../stores/useStore';
import { useTranslation } from 'react-i18next';
import { clearNotesAndTasks, db } from '../services/db';
import ApiUrlModal from './ApiUrlModal';
import { FaCog } from 'react-icons/fa';
import { WHATS_NEW_ENTRIES, hasActiveDataKey } from '@repo/shared';
import { getDefaultHotkeys } from '../lib/hotkeys';
import { enrollOrUnlockCrypto, changeCryptoPassword } from '../lib/crypto';
import { AdminDashboard } from './AdminDashboard';
import EmbeddingsSettings from './EmbeddingsSettings';
import { createCalendarSubscription, getCalendarUrl, revokeCalendarSubscription, createDavCredential, revokeDavCredential, hasDavCredential, getDavServerUrl, type DavCredential } from '../lib/calendarSubscription';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { language, setLanguage, autoLockTimeout, setAutoLockTimeout } = useStore();
  const fetchNotes = useStore((s) => s.fetchNotes);
  const fetchTasks = useStore((s) => s.fetchTasks);
  const isOffline = useStore((s) => s.isOffline);
  const syncOfflineChanges = useStore((s) => s.syncOfflineChanges);
  const [pendingCount, setPendingCount] = React.useState<number | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const refreshPending = React.useCallback(async () => {
    try {
      const [n, t2] = await Promise.all([db.getPendingSyncNotes(), db.getPendingSyncTasks()]);
      setPendingCount(n.length + t2.length);
    } catch { setPendingCount(null); }
  }, []);
  React.useEffect(() => { if (isOpen) void refreshPending(); }, [isOpen, refreshPending]);
  const handleSyncNow = async () => {
    setSyncing(true);
    try { await syncOfflineChanges(); await Promise.all([fetchNotes(), fetchTasks()]); } finally { setSyncing(false); await refreshPending(); }
  };

  // Calendar (ICS) subscription — paste the link into Google/Apple Calendar.
  const [calendarUrl, setCalendarUrl] = React.useState<string | null>(null);
  const [calendarBusy, setCalendarBusy] = React.useState(false);
  const [calendarMsg, setCalendarMsg] = React.useState<string | null>(null);
  React.useEffect(() => { if (isOpen) setCalendarUrl(getCalendarUrl()); }, [isOpen]);
  const handleCreateOrCopyCalendar = async () => {
    setCalendarBusy(true);
    setCalendarMsg(null);
    try {
      let url = calendarUrl;
      if (!url) {
        const sub = await createCalendarSubscription();
        url = sub.url;
        setCalendarUrl(url);
      }
      try { await navigator.clipboard.writeText(url); setCalendarMsg('Länk kopierad — klistra in i din kalender (Prenumerera via URL).'); }
      catch { setCalendarMsg(url); }
    } catch (e: any) {
      setCalendarMsg(e?.message || 'Kunde inte skapa kalenderlänk.');
    } finally {
      setCalendarBusy(false);
    }
  };
  const handleRevokeCalendar = async () => {
    await revokeCalendarSubscription();
    setCalendarUrl(null);
    setCalendarMsg('Kalenderlänken är inaktiverad.');
  };

  // CalDAV (two-way) — a revocable Basic-Auth credential for the all-tasks scope.
  const [davCred, setDavCred] = React.useState<DavCredential | null>(null);
  const [davActive, setDavActive] = React.useState(false);
  const [davBusy, setDavBusy] = React.useState(false);
  const [davMsg, setDavMsg] = React.useState<string | null>(null);
  React.useEffect(() => { if (isOpen) setDavActive(hasDavCredential()); }, [isOpen]);
  const handleEnableDav = async () => {
    setDavBusy(true); setDavMsg(null);
    try {
      const cred = await createDavCredential(null, 'Alla uppgifter');
      setDavCred(cred); setDavActive(true);
      setDavMsg('CalDAV aktiverat. Spara lösenordet nu — det visas bara denna gång.');
    } catch (e: any) { setDavMsg(e?.message || 'Kunde inte aktivera CalDAV.'); }
    finally { setDavBusy(false); }
  };
  const handleRevokeDav = async () => {
    await revokeDavCredential(null);
    setDavCred(null); setDavActive(false);
    setDavMsg('CalDAV är inaktiverat. Befintliga kopplingar slutar fungera direkt.');
  };
  const copyText = async (v: string) => { try { await navigator.clipboard.writeText(v); setDavMsg('Kopierat.'); } catch { /* ignore */ } };
  const setActiveTab = useStore((s) => s.setActiveTab);
  const selectNote = useStore((s) => s.selectNote);
  const { t } = useTranslation();
  const [showClearConfirm, setShowClearConfirm] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [isApiModalOpen, setIsApiModalOpen] = React.useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = React.useState(true);

  // Enhanced (v3) end-to-end encryption enrolment.
  const [e2eActive, setE2eActive] = React.useState(false);
  const [e2ePassword, setE2ePassword] = React.useState('');
  const [e2eBusy, setE2eBusy] = React.useState(false);
  const [e2eMsg, setE2eMsg] = React.useState<string | null>(null);
  React.useEffect(() => { setE2eActive(hasActiveDataKey()); }, [isOpen]);

  const handleEnableE2E = async () => {
    if (!e2ePassword) return;
    setE2eBusy(true);
    setE2eMsg(null);
    try {
      const outcome = await enrollOrUnlockCrypto(e2ePassword);
      setE2eActive(true);
      setE2ePassword('');
      setE2eMsg(
        outcome.result === 'enrolled' && outcome.recoveryCode
          ? `Aktiverad. Spara din återställningskod säkert: ${outcome.recoveryCode}`
          : 'Förstärkt kryptering upplåst för denna session.',
      );
    } catch {
      setE2eMsg('Kunde inte aktivera. Kontrollera lösenordet och anslutningen.');
    } finally {
      setE2eBusy(false);
    }
  };

  // Change E2E password (re-wraps the dataKey; no content re-encryption).
  const [oldPw, setOldPw] = React.useState('');
  const [newPw, setNewPw] = React.useState('');
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwMsg, setPwMsg] = React.useState<string | null>(null);

  const handleChangePassword = async () => {
    if (!oldPw || !newPw) return;
    setPwBusy(true);
    setPwMsg(null);
    try {
      await changeCryptoPassword(oldPw, newPw);
      setOldPw('');
      setNewPw('');
      setPwMsg('Lösenordet är bytt. Ingen data behövde krypteras om; återställningskoden fungerar fortfarande.');
    } catch {
      setPwMsg('Kunde inte byta lösenord. Kontrollera det gamla lösenordet och anslutningen.');
    } finally {
      setPwBusy(false);
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
        window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{t('settings.title')}</h2>
          <button
            onClick={() => setIsApiModalOpen(true)}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="API settings"
            title="API settings"
            type="button"
          >
            <FaCog />
          </button>
        </div>
        
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

        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Synkning</h3>
          <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {isOffline
                ? 'Offline — ändringar synkas automatiskt när nätet återkommer'
                : pendingCount && pendingCount > 0
                  ? `${pendingCount} ändringar väntar på synk`
                  : 'Allt är synkat'}
            </div>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing || isOffline}
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
              data-testid="settings-sync-now"
            >
              {syncing ? 'Synkar…' : 'Synka nu'}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Kalender</h3>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
              Prenumerera på dina uppgifter i Google Kalender eller Kalender på Mac. Endast titel + datum delas; uppdateras när du ändrar uppgifter.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreateOrCopyCalendar}
                disabled={calendarBusy}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
                data-testid="settings-calendar-link"
              >
                {calendarBusy ? 'Arbetar…' : calendarUrl ? 'Kopiera kalenderlänk' : 'Skapa kalenderlänk'}
              </button>
              {calendarUrl ? (
                <button
                  type="button"
                  onClick={handleRevokeCalendar}
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-sm"
                >
                  Inaktivera
                </button>
              ) : null}
            </div>
            {calendarMsg ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 break-all">{calendarMsg}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">CalDAV (två­vägs)</h3>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
              Synka alla dina uppgifter med Påminnelser (Mac/iOS) eller Tasks.org (Android) — bockar du av en uppgift där, bockas den av här. Eget lösenord per koppling, aldrig ditt kontolösenord, och kan återkallas direkt. Endast titel + datum + status delas; låsta listor delas aldrig.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEnableDav}
                disabled={davBusy}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
                data-testid="settings-caldav-enable"
              >
                {davBusy ? 'Arbetar…' : davActive ? 'Skapa nytt lösenord' : 'Aktivera CalDAV'}
              </button>
              {davActive ? (
                <button
                  type="button"
                  onClick={handleRevokeDav}
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-sm"
                >
                  Inaktivera
                </button>
              ) : null}
            </div>
            {davCred ? (
              <div className="mt-3 space-y-1.5 text-xs">
                {[
                  ['Server-URL', getDavServerUrl()],
                  ['Användarnamn', davCred.username],
                  ['Lösenord (visas en gång)', davCred.password || ''],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
                    <code className="flex-1 break-all rounded bg-gray-100 dark:bg-gray-800 px-2 py-1">{value}</code>
                    <button type="button" onClick={() => copyText(String(value))} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700">Kopiera</button>
                  </div>
                ))}
                <p className="text-amber-600 dark:text-amber-400">Spara lösenordet nu — det kan inte visas igen. Förlorat lösenord? Skapa ett nytt.</p>
              </div>
            ) : null}
            {davMsg ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 break-all">{davMsg}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <AdminDashboard />
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Förstärkt kryptering (E2E)</h3>
          {e2eActive ? (
            <div className="space-y-2">
              <p className="text-xs text-green-600 dark:text-green-400">
                Aktiv — anteckningar krypteras end-to-end (AES-256-GCM) med en nyckel härledd från ditt lösenord.
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300">Byt krypteringslösenord (ingen data krypteras om):</p>
              <input
                type="password"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                placeholder="Nuvarande lösenord"
                autoComplete="current-password"
                className="w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Nytt lösenord"
                autoComplete="new-password"
                className="w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={pwBusy || !oldPw || !newPw}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
              >
                {pwBusy ? 'Byter…' : 'Byt lösenord'}
              </button>
              {pwMsg && <p className="mt-1 text-xs text-gray-700 dark:text-gray-200 break-words">{pwMsg}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Lås upp med ditt lösenord för att aktivera. Nyckeln stannar i denna flik (sessionStorage) och lämnar aldrig servern.
              </p>
              <input
                type="password"
                value={e2ePassword}
                onChange={(e) => setE2ePassword(e.target.value)}
                placeholder={t('common.password', 'Lösenord')}
                autoComplete="current-password"
                className="w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={handleEnableE2E}
                disabled={e2eBusy || !e2ePassword}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
              >
                {e2eBusy ? 'Aktiverar…' : 'Aktivera'}
              </button>
            </div>
          )}
          {e2eMsg && <p className="mt-2 text-xs text-gray-700 dark:text-gray-200 break-words">{e2eMsg}</p>}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Semantisk sök</h3>
          <EmbeddingsSettings />
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">Kortkommandon</h3>
          <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {Object.entries(getDefaultHotkeys()).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded px-2 py-1">
                <span>{key}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {/* Per-app running version: which build this client actually is. */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {(typeof window !== 'undefined' && (window as any).mlc?.isElectron) ? 'Noter Desktop' : 'Noter Web'}
            </span>
            {WHATS_NEW_ENTRIES[0] && (
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400" data-testid="app-version">
                v{WHATS_NEW_ENTRIES[0].version} ({WHATS_NEW_ENTRIES[0].build})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setWhatsNewOpen((prev) => !prev)}
            className="w-full text-left text-sm font-medium text-gray-600 dark:text-gray-300 mb-2"
          >
            What&apos;s New
          </button>
          {whatsNewOpen && (
            <div className="max-h-40 overflow-y-auto space-y-2">
              {WHATS_NEW_ENTRIES.map((entry) => (
                <div key={`${entry.version}-${entry.build}`} className="border border-gray-200 dark:border-gray-700 rounded p-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                    v{entry.version} ({entry.build}) • {entry.date}
                  </div>
                  <ul className="mt-1 text-xs text-gray-600 dark:text-gray-300 list-disc pl-4 space-y-0.5">
                    {entry.highlights.map((item, idx) => (
                      <li key={`${entry.version}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
            {t('settings.autoLockTimeout')}
          </label>
          <select
            value={autoLockTimeout}
            onChange={(e) => setAutoLockTimeout(Number(e.target.value))}
            aria-label={t('settings.autoLockTimeout')}
            className="w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value={1}>1 {t('common.minute')}</option>
            <option value={5}>5 {t('common.minutes')}</option>
            <option value={15}>15 {t('common.minutes')}</option>
            <option value={50}>50 {t('common.minutes')}</option>
            <option value={60}>1 {t('common.hour')}</option>
            <option value={180}>3 {t('common.hours')}</option>
          </select>
        </div>

        <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-4 text-xs text-gray-500 dark:text-gray-400">
            <p>Build ID: {process.env.NEXT_PUBLIC_BUILD_ID}</p>
            <p>Timestamp: {process.env.NEXT_PUBLIC_BUILD_TIMESTAMP}</p>
        </div>

        <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Rensa lokal lagring</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Tar bort anteckningar, projektmappar, tasks och tasklistor lokalt.</div>
            </div>
            <button
              className="px-3 py-2 rounded bg-red-500 text-white hover:bg-red-600 text-sm"
              onClick={() => setShowClearConfirm(true)}
            >
              Rensa
            </button>
          </div>
          {showClearConfirm && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-gray-600 dark:text-gray-300">Är du säker?</span>
              <button
                className="px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                onClick={() => setShowClearConfirm(false)}
              >
                Avbryt
              </button>
              <button
                className="px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600"
                disabled={clearing}
                onClick={async () => {
                  setClearing(true);
                  try {
                    await clearNotesAndTasks();
                    if (typeof window !== 'undefined') {
                      localStorage.removeItem('selectedNoteId');
                      localStorage.removeItem('lastSelectedNoteId');
                      localStorage.removeItem('lastSelectedTaskListId');
                      localStorage.removeItem('activeTab');
                      localStorage.removeItem('viewMode');
                    }
                    useStore.setState({ notes: [], tasks: [], selectedNoteId: null, selectedTaskListId: null });
                    selectNote(null as any);
                    setActiveTab('notes');
                    await fetchNotes();
                    await fetchTasks();
                  } finally {
                    setClearing(false);
                    setShowClearConfirm(false);
                  }
                }}
              >
                Bekräfta
              </button>
            </div>
          )}
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
      <ApiUrlModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />
    </div>
  );
}
