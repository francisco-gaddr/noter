'use client';
/**
 * Nextcloud ingestion + selective Neo4j settings (web/Electron). Connect a self-hosted
 * Nextcloud, choose which folders to sync IN (their files become E2E-encrypted, indexable
 * notes), and choose exactly which project folders / task-lists / file-folders are mirrored
 * to a self-hosted Neo4j. Credentials are stored encrypted on this device and never sent to
 * the Noter backend. See Doc/nextcloud-ingestion.md.
 */
import React from 'react';
import { useStore } from '../stores/useStore';
import { normalizeNoteType, normalizeNextcloudBaseUrl, type WebdavConnection, type Neo4jConfig } from '@repo/shared';
import {
  listConnections, saveConnection, deleteConnection, testConnection, syncConnection, browseFolders,
  syncDueConnections, getNeo4jConfig, saveNeo4jConfig, neo4jStatus, pushNeo4j, startNextcloudOAuth,
  getTargetFolderId, setTargetFolderId,
} from '../services/nextcloud';
import type { WebdavEntry } from '@repo/shared';

const INTERVALS: Array<{ v: number; label: string }> = [
  { v: 0, label: 'Manuell' }, { v: 15, label: 'Var 15 min' }, { v: 60, label: 'Varje timme' }, { v: 360, label: 'Var 6:e timme' },
];

const newId = (): string => {
  try { return (crypto as any).randomUUID(); } catch { return 'nc_' + Math.abs(Date.now()).toString(36); }
};
const inputCls = 'w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800';

export const NextcloudSettings: React.FC = () => {
  const notes = useStore((s) => s.notes);

  const [conns, setConns] = React.useState<WebdavConnection[]>([]);
  const [neo4j, setNeo4j] = React.useState<Neo4jConfig>(() => getNeo4jConfig());
  const [neo4jAvailable, setNeo4jAvailable] = React.useState(false);
  const [msg, setMsg] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);

  // new/edit-connection form
  const [form, setForm] = React.useState({ name: '', host: '', username: '', password: '', roots: '' });
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const hostFromBaseUrl = (baseUrl: string): string => (baseUrl || '').replace(/^https?:\/\//i, '').split('/')[0];
  const startEdit = (c: WebdavConnection) => {
    setEditingId(c.id);
    setForm({ name: c.name, host: hostFromBaseUrl(c.baseUrl), username: c.username, password: '', roots: (c.rootPaths || []).join(', ') });
    setMsg('Redigerar — ändra och tryck "Uppdatera". Lämna lösenordet tomt för att behålla det.');
  };
  const cancelEdit = () => { setEditingId(null); setForm({ name: '', host: '', username: '', password: '', roots: '' }); setMsg(''); };
  const toggleIncludeInChat = (c: WebdavConnection) => { saveConnection({ ...c, includeInChat: c.includeInChat === false ? true : false }); refresh(); };

  // folder-browser picker state
  const [picker, setPicker] = React.useState<{ connId: string; path: string; entries: WebdavEntry[]; loading: boolean } | null>(null);

  const openPicker = async (conn: WebdavConnection, path = '') => {
    setPicker({ connId: conn.id, path, entries: [], loading: true });
    try { const entries = await browseFolders(conn, path); setPicker({ connId: conn.id, path, entries, loading: false }); }
    catch (e: any) { setMsg(e?.message || 'Kunde inte lista mappar'); setPicker(null); }
  };
  const toggleRoot = (conn: WebdavConnection, p: string) => {
    const set = new Set(conn.rootPaths);
    if (set.has(p)) set.delete(p); else set.add(p);
    saveConnection({ ...conn, rootPaths: Array.from(set) });
    refresh();
  };
  const setInterval = (conn: WebdavConnection, v: number) => { saveConnection({ ...conn, intervalMinutes: v }); refresh(); };
  const setMinLevel = (conn: WebdavConnection, v: string) => { saveConnection({ ...conn, minContextLevel: v || undefined }); refresh(); };

  React.useEffect(() => {
    setConns(listConnections());
    setNeo4j(getNeo4jConfig());
    neo4jStatus().then((s) => setNeo4jAvailable(!!s.enabled)).catch(() => {});
    // Run any auto-sync that is due, then refresh the list (best-effort).
    syncDueConnections().then((n) => { if (n > 0) setConns(listConnections()); }).catch(() => {});
  }, []);

  const refresh = () => setConns(listConnections());
  const updateNeo4j = (patch: Partial<Neo4jConfig>) => {
    const next = { ...neo4j, ...patch };
    setNeo4j(next);
    saveNeo4jConfig(next);
  };

  const saveConnectionForm = () => {
    setMsg('');
    try {
      const baseUrl = normalizeNextcloudBaseUrl(form.host.trim(), form.username.trim());
      const rootPaths = form.roots.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      if (editingId) {
        const existing = listConnections().find((c) => c.id === editingId);
        if (!existing) { setMsg('Anslutningen hittades inte'); setEditingId(null); return; }
        const updated: WebdavConnection = { ...existing, name: form.name.trim() || form.host.trim(), baseUrl, username: form.username.trim(), rootPaths };
        saveConnection(updated, form.password.trim() ? form.password : undefined);
        setMsg('✓ Anslutning uppdaterad');
      } else {
        const conn: WebdavConnection = {
          id: newId(), name: form.name.trim() || form.host.trim(), baseUrl, username: form.username.trim(),
          rootPaths, includeInChat: true, createdAt: new Date().toISOString(),
        };
        saveConnection(conn, form.password);
      }
      setForm({ name: '', host: '', username: '', password: '', roots: '' });
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setMsg(e?.message || 'Kunde inte spara anslutningen');
    }
  };

  const onOAuth = async () => {
    if (!form.host.trim()) return;
    setBusy(true); setMsg('Öppnar Nextcloud-inloggning i webbläsaren — slutför där…');
    const r = await startNextcloudOAuth(form.host.trim(), (u) => window.open(u, '_blank', 'noopener'), { name: form.name.trim() || undefined });
    setMsg(r.ok ? '✓ Inloggning klar — anslutning tillagd' : `✗ ${r.error}`);
    if (r.ok) { setForm({ name: '', host: '', username: '', password: '', roots: '' }); refresh(); }
    setBusy(false);
  };

  const onTest = async (conn: WebdavConnection) => {
    setBusy(true); setMsg('');
    const r = await testConnection(conn);
    setMsg(r.ok ? `✓ Anslutning OK: ${conn.name}` : `✗ ${r.error}`);
    setBusy(false);
  };

  const onSync = async (conn: WebdavConnection) => {
    setBusy(true); setMsg(`Synkar ${conn.name}…`);
    const r = await syncConnection(conn.id);
    setMsg(r.ok ? `✓ ${conn.name}: ${r.created} nya, ${r.updated} uppdaterade, ${r.deleted} borttagna` : `✗ ${r.error}`);
    setBusy(false);
  };

  const onDelete = (conn: WebdavConnection) => {
    deleteConnection(conn.id);
    refresh();
  };

  // Folder pools for the Neo4j selection.
  const live = (notes || []).filter((n: any) => !n.deleted);
  const projectFolders = live.filter((n: any) => normalizeNoteType(n.type) === 'project' && !n.source);
  const taskLists = live.filter((n: any) => normalizeNoteType(n.type) === 'task_list');
  const fileFolders = live.filter((n: any) => normalizeNoteType(n.type) === 'project' && !!n.source);

  const toggleId = (key: 'projectFolderIds' | 'taskListIds' | 'fileFolderIds', id: string) => {
    const set = new Set(neo4j[key]);
    if (set.has(id)) set.delete(id); else set.add(id);
    updateNeo4j({ [key]: Array.from(set) } as any);
  };

  const onPushNeo4j = async () => {
    setBusy(true); setMsg('Synkar till Neo4j…');
    const r = await pushNeo4j();
    setMsg(r.ok ? `✓ Neo4j: ${r.applied ?? 0} satser tillämpade` : `✗ ${r.error}`);
    setBusy(false);
  };

  const FolderList: React.FC<{ title: string; pool: any[]; sel: string[]; k: 'projectFolderIds' | 'taskListIds' | 'fileFolderIds' }> = ({ title, pool, sel, k }) => (
    <div>
      <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{title} ({pool.length})</div>
      {pool.length === 0 ? <p className="text-xs text-gray-400">Inga ännu.</p> : (
        <div className="max-h-32 overflow-auto space-y-1 pl-1">
          {pool.map((n) => (
            <label key={n._id} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={sel.includes(n._id)} onChange={() => toggleId(k, n._id)} />
              <span className="truncate">{n.title || '(namnlös)'}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="nextcloud-settings">
      <div>
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Nextcloud-mappar (synka in)</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Anslut din egenhostade Nextcloud och välj specifika mappar att synka in. Redigerbara filer (MD/text)
          blir anteckningar du kan ändra — ändringar synkas tillbaka till Nextcloud (tvåvägs). Bilder, PDF, Word
          och Excel synkas in och indexeras men visas inte bland anteckningarna. Använd ett <strong>app-lösenord</strong>.
        </p>
        <label className="block mt-2 text-xs text-gray-600 dark:text-gray-300">
          Projektmapp för synkat innehåll:
          <select
            value={getTargetFolderId() || ''}
            onChange={(e) => { setTargetFolderId(e.target.value || null); setMsg('Målmapp uppdaterad'); }}
            className="ml-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1"
          >
            <option value="">Auto (skapa "Nextcloud"-mapp)</option>
            {notes.filter((n: any) => !n.deleted && normalizeNoteType(n.type) === 'project' && !n.source)
              .map((n: any) => <option key={n._id} value={n._id}>{n.title || '(namnlös)'}</option>)}
          </select>
        </label>
      </div>

      {conns.map((c) => (
        <div key={c.id} className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.name}</span>
            <div className="flex gap-2">
              <button onClick={() => startEdit(c)} className="text-xs text-blue-600">Redigera</button>
              <button onClick={() => onDelete(c)} className="text-xs text-red-600">Ta bort</button>
            </div>
          </div>
          <div className="text-xs text-gray-500 break-all">{c.baseUrl}</div>
          <div className="text-xs text-gray-500">Mappar: {c.rootPaths.join(', ') || '(inga valda)'}</div>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200 pt-0.5">
            <input type="checkbox" checked={c.includeInChat !== false} onChange={() => toggleIncludeInChat(c)} />
            <span>Använd dessa filer i AI-chatten</span>
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => onTest(c)} disabled={busy} className="px-2 py-1 rounded border text-xs disabled:opacity-50">Testa</button>
            <button onClick={() => (picker?.connId === c.id ? setPicker(null) : openPicker(c))} disabled={busy} className="px-2 py-1 rounded border text-xs disabled:opacity-50">
              {picker?.connId === c.id ? 'Stäng mappar' : 'Välj mappar'}
            </button>
            <button onClick={() => onSync(c)} disabled={busy} className="px-2 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50">Synka nu</button>
            <select value={c.intervalMinutes || 0} onChange={(e) => setInterval(c, Number(e.target.value))} className="text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
              {INTERVALS.map((i) => <option key={i.v} value={i.v}>{i.label}</option>)}
            </select>
            <select value={c.minContextLevel || ''} onChange={(e) => setMinLevel(c, e.target.value)} className="text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1" title="Minsta kontextnivå för att tas med i AI-chatten">
              <option value="">Kontext: alltid</option>
              <option value="standard">Från standard</option>
              <option value="deep">Endast deep</option>
            </select>
          </div>

          {picker?.connId === c.id && (
            <div className="mt-2 rounded border border-gray-200 dark:border-gray-700 p-2">
              <div className="flex items-center gap-2 mb-1 text-xs">
                <button onClick={() => openPicker(c, '')} className="underline">Roten</button>
                {picker.path && <span className="text-gray-500">/ {picker.path}</span>}
              </div>
              {picker.loading ? <p className="text-xs text-gray-400">Laddar…</p> : picker.entries.length === 0 ? (
                <p className="text-xs text-gray-400">Inga undermappar.</p>
              ) : picker.entries.map((e) => (
                <div key={e.path} className="flex items-center gap-2 text-xs py-0.5">
                  <input type="checkbox" checked={c.rootPaths.includes(e.path)} onChange={() => toggleRoot(c, e.path)} />
                  <button className="underline truncate" onClick={() => openPicker(c, e.path)}>{e.name}/</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="rounded border border-dashed border-gray-300 dark:border-gray-600 p-2 space-y-2">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-300">{editingId ? 'Redigera anslutning' : 'Lägg till anslutning'}</div>
        <input className={inputCls} placeholder="Namn (valfritt)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputCls} placeholder="Värd, t.ex. cloud.exempel.se" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
        <input className={inputCls} placeholder="Användarnamn" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
        <input className={inputCls} type="password" placeholder={editingId ? 'App-lösenord (lämna tomt = behåll)' : 'App-lösenord'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" />
        <input className={inputCls} placeholder="Mappar (eller använd 'Välj mappar' på anslutningen)" value={form.roots} onChange={(e) => setForm({ ...form, roots: e.target.value })} />
        <div className="flex flex-wrap gap-2">
          <button onClick={saveConnectionForm} className="px-3 py-1.5 rounded bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-sm">{editingId ? 'Uppdatera anslutning' : 'Spara anslutning'}</button>
          {editingId && <button onClick={cancelEdit} className="px-3 py-1.5 rounded border text-sm">Avbryt</button>}
          {!editingId && <button onClick={onOAuth} disabled={busy || !form.host.trim()} className="px-3 py-1.5 rounded border text-sm disabled:opacity-50" title="Logga in i webbläsaren och bevilja ett app-lösenord automatiskt">Logga in via Nextcloud (OAuth)</button>}
        </div>
        <p className="text-xs text-gray-400">OAuth kräver bara värden ovan — du loggar in i webbläsaren och beviljar åtkomst; inget lösenord behöver skrivas.</p>
      </div>

      <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={neo4j.enabled} onChange={(e) => updateNeo4j({ enabled: e.target.checked })} />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Spegla valda mappar till self-hostad Neo4j</span>
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Välj exakt vilka mappar som mirroras till din egen Neo4j (kunskapsgraf för Cypher/GraphRAG). Endast titlar +
          struktur som standard; låsta mappar speglas aldrig. {neo4jAvailable ? '' : 'OBS: servern rapporterar att Neo4j inte är aktiverad (NEO4J_ENABLED).'}
        </p>

        {neo4j.enabled && (
          <div className="space-y-2 pl-1 mt-2 border-l-2 border-gray-200 dark:border-gray-700">
            <div className="pl-2 space-y-2">
              <FolderList title="Projektmappar" pool={projectFolders} sel={neo4j.projectFolderIds} k="projectFolderIds" />
              <FolderList title="Uppgiftslistor" pool={taskLists} sel={neo4j.taskListIds} k="taskListIds" />
              <FolderList title="Filmappar (Nextcloud)" pool={fileFolders} sel={neo4j.fileFolderIds} k="fileFolderIds" />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={neo4j.includeBody} onChange={(e) => updateNeo4j({ includeBody: e.target.checked })} />
                <span className="text-xs text-gray-600 dark:text-gray-300">Inkludera brödtext (annars bara titlar + struktur)</span>
              </label>
              <button onClick={onPushNeo4j} disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50">Synka till Neo4j</button>
            </div>
          </div>
        )}
      </div>

      {msg && <p className="text-xs text-gray-600 dark:text-gray-300" data-testid="nextcloud-msg">{msg}</p>}
    </div>
  );
};

export default NextcloudSettings;
