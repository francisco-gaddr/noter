'use client';

import React from 'react';
import { useStore } from '../stores/useStore';
import { buildSecurityNoteMap, isReadableWithLocks, normalizeNoteType } from '@repo/shared';
import {
  type MarkdownShare, type MintedDavCredential, type MintedCrdtToken,
  refreshMarkdownShares, getCachedMarkdownShares, createMarkdownShare, updateMarkdownShare,
  deleteMarkdownShare, mintMarkdownDav, revokeMarkdownDav, mintMarkdownCrdt, revokeMarkdownCrdt,
} from '../lib/markdownShare';

/**
 * Settings panel: External Markdown "delningar" (shares). Expose chosen notes/project-
 * folders as a Markdown vault for Obsidian/Finder/Android/widgets. Per share: pick the
 * transports (WebDAV and/or Live/CRDT), the allowed directions, the WebDAV login
 * (copy/rotate/revoke), and Live token. Locked notes are never exposed.
 */
type EditState = {
  shareId?: string;
  name: string;
  folderIds: string[];
  noteIds: string[];
  modes: { webdav: boolean; crdt: boolean };
  direction: { outbound: boolean; inbound: boolean };
};
const newEdit = (): EditState => ({ name: '', folderIds: [], noteIds: [], modes: { webdav: true, crdt: false }, direction: { outbound: true, inbound: true } });

export default function MarkdownSharesSettings() {
  const notes = useStore((s) => s.notes);
  const unlocked = useStore((s) => s.unlockedProtectedNoteIds);

  const { folders, plainNotes } = React.useMemo(() => {
    const all = (notes || []) as any[];
    const noteMap = buildSecurityNoteMap(all as any);
    const u = new Set<string>(unlocked || []);
    const readable = all.filter((n) => isReadableWithLocks(n as any, noteMap as any, u));
    return {
      folders: readable.filter((n) => normalizeNoteType(n.type) === 'project'),
      plainNotes: readable.filter((n) => normalizeNoteType(n.type) === 'note'),
    };
  }, [notes, unlocked]);

  const [shares, setShares] = React.useState<MarkdownShare[]>(getCachedMarkdownShares());
  const [editing, setEditing] = React.useState<EditState | null>(null);
  const [cred, setCred] = React.useState<MintedDavCredential | null>(null);
  const [liveTok, setLiveTok] = React.useState<MintedCrdtToken | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => { refreshMarkdownShares().then(setShares).catch(() => {}); }, []);
  const reload = async () => { try { setShares(await refreshMarkdownShares()); } catch { /* ignore */ } };

  const scopeLabel = (s: MarkdownShare) => {
    const f = s.folderIds?.length ? `${s.folderIds.length} mapp(ar)` : '';
    const n = s.noteIds?.length ? `${s.noteIds.length} anteckning(ar)` : '';
    return [f, n].filter(Boolean).join(' + ') || 'Inget valt';
  };
  const transportLabel = (s: MarkdownShare) => {
    const t = [s.modes?.webdav && 'WebDAV', s.modes?.crdt && 'Live'].filter(Boolean).join(' + ') || 'Inget';
    const d = s.direction?.outbound && s.direction?.inbound ? '↔' : s.direction?.outbound ? '→' : s.direction?.inbound ? '←' : '—';
    return `${t} ${d}`;
  };
  const copy = async (v: string, label: string) => { try { await navigator.clipboard.writeText(v); setMsg(`Kopierat: ${label}`); } catch { /* ignore */ } };

  const saveEditing = async () => {
    if (!editing) return;
    setBusy(true); setMsg(null);
    try {
      const name = editing.name.trim() || 'Markdown-delning';
      const payload = { name, folderIds: editing.folderIds, noteIds: editing.noteIds, modes: editing.modes, direction: editing.direction };
      if (editing.shareId) await updateMarkdownShare(editing.shareId, payload);
      else await createMarkdownShare(payload);
      setEditing(null); await reload();
    } catch (e: any) { setMsg(e?.message || 'Kunde inte spara delningen.'); }
    finally { setBusy(false); }
  };
  const remove = async (s: MarkdownShare) => {
    if (!window.confirm(`Ta bort delningen "${s.name}"? Extern åtkomst slutar fungera direkt.`)) return;
    await deleteMarkdownShare(s.shareId); await reload();
  };
  const enableDav = async (s: MarkdownShare) => {
    setBusy(true); setMsg(null);
    try { setCred(await mintMarkdownDav(s.shareId)); setLiveTok(null); await reload(); }
    catch (e: any) { setMsg(e?.message || 'Kunde inte skapa WebDAV-inlogg.'); }
    finally { setBusy(false); }
  };
  const revokeDav = async (s: MarkdownShare) => { await revokeMarkdownDav(s.shareId); setCred(null); await reload(); };
  const enableLive = async (s: MarkdownShare) => {
    setBusy(true); setMsg(null);
    try { setLiveTok(await mintMarkdownCrdt(s.shareId)); setCred(null); await reload(); }
    catch (e: any) { setMsg(e?.message || 'Kunde inte aktivera Live-läge.'); }
    finally { setBusy(false); }
  };
  const revokeLive = async (s: MarkdownShare) => { await revokeMarkdownCrdt(s.shareId); setLiveTok(null); await reload(); };

  const toggle = (key: 'folderIds' | 'noteIds', id: string) =>
    setEditing((e) => e && ({ ...e, [key]: e[key].includes(id) ? e[key].filter((x) => x !== id) : [...e[key], id] }));

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">Extern Markdown-delning</h3>
        <button type="button" onClick={() => setEditing(newEdit())} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">+ Ny delning</button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Exponera valda anteckningar/mappar som en Markdown-vault för Obsidian, Mac, Android och widgets. Välj WebDAV och/eller Live (CRDT) och tillåtna riktningar. Låsta anteckningar delas aldrig.</p>

      {editing && (
        <div className="rounded-lg border border-blue-300 dark:border-blue-700 p-3 mb-3">
          <div className="text-sm font-medium mb-2">{editing.shareId ? 'Redigera delning' : 'Ny delning'}</div>
          <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Namn (t.ex. Wiki)" className="w-full mb-2 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-transparent text-sm" />

          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 mt-2">Transport</div>
          <div className="flex flex-wrap gap-4 text-sm mb-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.modes.webdav} onChange={() => setEditing({ ...editing, modes: { ...editing.modes, webdav: !editing.modes.webdav } })} />WebDAV (Obsidian/Finder/Android/widgets)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.modes.crdt} onChange={() => setEditing({ ...editing, modes: { ...editing.modes, crdt: !editing.modes.crdt } })} />Live (CRDT) — realtid</label>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Riktning</div>
          <div className="flex flex-wrap gap-4 text-sm mb-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.direction.outbound} onChange={() => setEditing({ ...editing, direction: { ...editing.direction, outbound: !editing.direction.outbound } })} />Utåt (appen → externt)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.direction.inbound} onChange={() => setEditing({ ...editing, direction: { ...editing.direction, inbound: !editing.direction.inbound } })} />Inåt (externt → appen)</label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Projektmappar</div>
              <div className="max-h-40 overflow-auto rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                {folders.length === 0 ? <div className="px-2 py-2 text-xs text-gray-400">Inga mappar.</div> : folders.map((f: any) => (
                  <label key={f._id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer"><input type="checkbox" checked={editing.folderIds.includes(f._id)} onChange={() => toggle('folderIds', f._id)} />{f.title || 'Mapp'}</label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Enskilda anteckningar</div>
              <div className="max-h-40 overflow-auto rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                {plainNotes.length === 0 ? <div className="px-2 py-2 text-xs text-gray-400">Inga anteckningar.</div> : plainNotes.slice(0, 300).map((n: any) => (
                  <label key={n._id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer"><input type="checkbox" checked={editing.noteIds.includes(n._id)} onChange={() => toggle('noteIds', n._id)} />{n.title || 'Anteckning'}</label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-sm">Avbryt</button>
            <button type="button" onClick={saveEditing} disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{busy ? 'Sparar…' : 'Spara'}</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {shares.length === 0 && !editing ? (
          <div className="text-xs text-gray-400">Inga delningar ännu. Skapa en för att exponera valda anteckningar.</div>
        ) : shares.map((s) => (
          <div key={s.shareId} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{s.name || 'Delning'}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{scopeLabel(s)} · {s.count ?? 0} filer · {transportLabel(s)}</span>
                <button type="button" onClick={() => setEditing({ shareId: s.shareId, name: s.name, folderIds: s.folderIds || [], noteIds: s.noteIds || [], modes: s.modes || { webdav: true, crdt: false }, direction: s.direction || { outbound: true, inbound: true } })} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700">Ändra</button>
                <button type="button" onClick={() => remove(s)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-red-600">Ta bort</button>
              </div>
            </div>
            {s.modes?.webdav && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <span className="text-sm text-gray-600 dark:text-gray-300">WebDAV-inlogg (tvåvägs){s.dav ? ' · aktiv' : ''}</span>
                <div className="flex items-center gap-2">
                  {s.dav ? <button type="button" onClick={() => copy(s.dav!.collectionUrl, 'WebDAV-URL')} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700">Kopiera URL</button> : null}
                  <button type="button" onClick={() => enableDav(s)} disabled={busy} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-50">{s.dav ? 'Nytt lösenord' : 'Skapa inlogg'}</button>
                  {s.dav ? <button type="button" onClick={() => revokeDav(s)} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700 text-red-600">Inaktivera</button> : null}
                </div>
              </div>
            )}
            {s.modes?.crdt && (
              <div className="flex items-center justify-between mt-1 pt-2 border-t border-gray-100 dark:border-gray-800">
                <span className="text-sm text-gray-600 dark:text-gray-300">Live (CRDT){s.crdt?.enabled ? ' · aktiv' : ''}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => enableLive(s)} disabled={busy} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-50">{s.crdt?.enabled ? 'Ny token' : 'Aktivera Live'}</button>
                  {s.crdt?.enabled ? <button type="button" onClick={() => revokeLive(s)} className="text-sm px-3 py-1 rounded border border-gray-300 dark:border-gray-700 text-red-600">Stäng Live</button> : null}
                </div>
              </div>
            )}
            {cred && cred.shareId === s.shareId && (
              <div className="mt-2 rounded border border-amber-300 dark:border-amber-700 p-2 text-xs space-y-1">
                {([['Server-URL', cred.serverUrl], ['Mapp-URL', cred.collectionUrl], ['Användarnamn', cred.username], ['Lösenord (visas en gång)', cred.password]] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
                    <code className="flex-1 break-all rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5">{value}</code>
                    <button type="button" onClick={() => copy(value, label)} className="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700">Kopiera</button>
                  </div>
                ))}
                <p className="text-amber-600 dark:text-amber-400">Lägg till i Obsidian (Remotely Save → WebDAV), Finder (Anslut till server) eller en Android WebDAV-app. Spara lösenordet — det visas bara nu.</p>
              </div>
            )}
            {liveTok && liveTok.shareId === s.shareId && (
              <div className="mt-2 rounded border border-amber-300 dark:border-amber-700 p-2 text-xs space-y-1">
                {([['WebSocket-URL', liveTok.wsUrl], ['Token (visas en gång)', liveTok.token]] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
                    <code className="flex-1 break-all rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5">{value}</code>
                    <button type="button" onClick={() => copy(value, label)} className="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700">Kopiera</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {msg ? <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 break-all">{msg}</p> : null}
    </div>
  );
}
