'use client';

import React from 'react';
import { useStore } from '../stores/useStore';
import { buildSecurityNoteMap, isReadableWithLocks } from '@repo/shared';
import {
  type Share, type MintedDavCredential,
  refreshShares, getCachedShares, createShare, updateShare, deleteShare, mintShareDav, revokeShareDav,
} from '../lib/calendarSubscription';

/**
 * Settings panel: calendar/CalDAV "delningar" (shares). A share covers a chosen SET of
 * task-lists (or all) under ONE ICS link + ONE CalDAV login. One place to copy, rotate
 * and revoke — for a single list or any combination. Locked lists are never selectable.
 */
export default function CalendarSharesSettings() {
  const notes = useStore((s) => s.notes);
  const unlocked = useStore((s) => s.unlockedProtectedNoteIds);

  const lists = React.useMemo(() => {
    const map = buildSecurityNoteMap((notes as any) || []);
    const set = new Set(unlocked || []);
    return ((notes as any[]) || [])
      .filter((n) => (n.type === 'task_list' || n.type === 'project') && isReadableWithLocks(map.get(n._id), map, set))
      .map((n) => ({ id: String(n._id), name: String(n.title || 'Namnlös lista') }));
  }, [notes, unlocked]);
  const nameOf = (id: string) => lists.find((l) => l.id === id)?.name || 'Lista';

  const [shares, setShares] = React.useState<Share[]>(getCachedShares());
  const [editing, setEditing] = React.useState<null | { shareId?: string; name: string; listIds: string[] }>(null);
  const [cred, setCred] = React.useState<MintedDavCredential | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => { refreshShares().then(setShares).catch(() => {}); }, []);
  const reload = async () => { try { setShares(await refreshShares()); } catch { /* ignore */ } };

  const scopeLabel = (s: Share) =>
    !s.listIds.length ? 'Alla uppgifter' : `${s.listIds.length} ${s.listIds.length === 1 ? 'lista' : 'listor'} · ${s.listIds.map(nameOf).join(', ')}`;

  const copy = async (v: string, label: string) => { try { await navigator.clipboard.writeText(v); setMsg(`Kopierat: ${label}`); } catch { /* ignore */ } };

  const saveEditing = async () => {
    if (!editing) return;
    setBusy(true); setMsg(null);
    try {
      const name = editing.name.trim() || 'Delning';
      if (editing.shareId) await updateShare(editing.shareId, { name, listIds: editing.listIds });
      else await createShare(name, editing.listIds);
      setEditing(null);
      await reload();
    } catch (e: any) { setMsg(e?.message || 'Kunde inte spara delningen.'); }
    finally { setBusy(false); }
  };
  const remove = async (s: Share) => {
    if (!window.confirm(`Ta bort delningen "${s.name}"? Länken och inloggningen slutar fungera.`)) return;
    await deleteShare(s.shareId); await reload();
  };
  const enableDav = async (s: Share) => {
    setBusy(true); setMsg(null);
    try { setCred(await mintShareDav(s.shareId)); await reload(); }
    catch (e: any) { setMsg(e?.message || 'Kunde inte aktivera CalDAV.'); }
    finally { setBusy(false); }
  };
  const revokeDav = async (s: Share) => { await revokeShareDav(s.shareId); setCred(null); await reload(); };

  const toggleList = (id: string) => setEditing((e) => e && ({ ...e, listIds: e.listIds.includes(id) ? e.listIds.filter((x) => x !== id) : [...e.listIds, id] }));

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">Kalender &amp; CalDAV — delningar</h3>
        <button type="button" onClick={() => setEditing({ name: '', listIds: [] })} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">+ Ny delning</button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Varje delning samlar valda uppgiftslistor under en kalenderlänk och ett CalDAV-inlogg. Välj en lista eller flera. Låsta listor delas aldrig.</p>

      {editing && (
        <div className="rounded-lg border border-blue-300 dark:border-blue-700 p-3 mb-3">
          <div className="text-sm font-medium mb-2">{editing.shareId ? 'Redigera delning' : 'Ny delning'}</div>
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="Namn (t.ex. Jobb)"
            className="w-full mb-2 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-transparent text-sm"
          />
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Uppgiftslistor (inga valda = alla uppgifter)</div>
          <div className="max-h-44 overflow-auto rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
            {lists.length === 0 ? (
              <div className="px-2 py-2 text-xs text-gray-400">Inga uppgiftslistor ännu.</div>
            ) : lists.map((l) => (
              <label key={l.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={editing.listIds.includes(l.id)} onChange={() => toggleList(l.id)} />
                {l.name}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-sm">Avbryt</button>
            <button type="button" onClick={saveEditing} disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{busy ? 'Sparar…' : 'Spara'}</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {shares.length === 0 && !editing ? (
          <div className="text-xs text-gray-400">Inga delningar ännu. Skapa en för att få en kalenderlänk eller ett CalDAV-inlogg.</div>
        ) : shares.map((s) => (
          <div key={s.shareId} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{s.name || 'Delning'}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{scopeLabel(s)}</span>
                <button type="button" onClick={() => setEditing({ shareId: s.shareId, name: s.name, listIds: s.listIds })} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700">Ändra</button>
                <button type="button" onClick={() => remove(s)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-red-600">Ta bort</button>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <span className="text-sm text-gray-600 dark:text-gray-300">Kalenderlänk (ICS)</span>
              <button type="button" onClick={() => copy(s.icsUrl, 'kalenderlänk')} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700">Kopiera</button>
            </div>
            <div className="flex items-center justify-between mt-1 pt-2 border-t border-gray-100 dark:border-gray-800">
              <span className="text-sm text-gray-600 dark:text-gray-300">CalDAV-inlogg (tvåvägs){s.dav ? ' · aktiv' : ''}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => enableDav(s)} disabled={busy} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-50">{s.dav ? 'Nytt lösenord' : 'Skapa inlogg'}</button>
                {s.dav ? <button type="button" onClick={() => revokeDav(s)} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700 text-red-600">Inaktivera</button> : null}
              </div>
            </div>
            {cred && cred.shareId === s.shareId && (
              <div className="mt-2 rounded border border-amber-300 dark:border-amber-700 p-2 text-xs space-y-1">
                {([['Server-URL', cred.serverUrl], ['Användarnamn', cred.username], ['Lösenord (visas en gång)', cred.password]] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
                    <code className="flex-1 break-all rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5">{value}</code>
                    <button type="button" onClick={() => copy(value, label)} className="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700">Kopiera</button>
                  </div>
                ))}
                <p className="text-amber-600 dark:text-amber-400">Lägg till som CalDAV-konto i Påminnelser (Mac/iOS) eller Tasks.org (Android). Spara lösenordet — det visas bara nu.</p>
              </div>
            )}
          </div>
        ))}
      </div>
      {msg ? <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 break-all">{msg}</p> : null}
    </div>
  );
}
