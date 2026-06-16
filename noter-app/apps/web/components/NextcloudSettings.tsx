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
  listConnections, saveConnection, deleteConnection, testConnection, syncConnection,
  getNeo4jConfig, saveNeo4jConfig, neo4jStatus, pushNeo4j,
} from '../services/nextcloud';

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

  // new-connection form
  const [form, setForm] = React.useState({ name: '', host: '', username: '', password: '', roots: '' });

  React.useEffect(() => {
    setConns(listConnections());
    setNeo4j(getNeo4jConfig());
    neo4jStatus().then((s) => setNeo4jAvailable(!!s.enabled)).catch(() => {});
  }, []);

  const refresh = () => setConns(listConnections());
  const updateNeo4j = (patch: Partial<Neo4jConfig>) => {
    const next = { ...neo4j, ...patch };
    setNeo4j(next);
    saveNeo4jConfig(next);
  };

  const addConnection = () => {
    setMsg('');
    try {
      const baseUrl = normalizeNextcloudBaseUrl(form.host.trim(), form.username.trim());
      const conn: WebdavConnection = {
        id: newId(),
        name: form.name.trim() || form.host.trim(),
        baseUrl,
        username: form.username.trim(),
        rootPaths: form.roots.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        createdAt: new Date().toISOString(),
      };
      saveConnection(conn, form.password);
      setForm({ name: '', host: '', username: '', password: '', roots: '' });
      refresh();
    } catch (e: any) {
      setMsg(e?.message || 'Kunde inte spara anslutningen');
    }
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
          Anslut din egenhostade Nextcloud och välj specifika mappar att synka in. Filerna (MD/text/PDF) blir
          krypterade, sökbara anteckningar. Använd ett <strong>app-lösenord</strong> (Nextcloud → Inställningar →
          Säkerhet), inte ditt kontolösenord. Lösenordet lagras krypterat här och skickas aldrig till servern.
        </p>
      </div>

      {conns.map((c) => (
        <div key={c.id} className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.name}</span>
            <button onClick={() => onDelete(c)} className="text-xs text-red-600">Ta bort</button>
          </div>
          <div className="text-xs text-gray-500 break-all">{c.baseUrl}</div>
          <div className="text-xs text-gray-500">Mappar: {c.rootPaths.join(', ') || '(inga valda)'}</div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => onTest(c)} disabled={busy} className="px-2 py-1 rounded border text-xs disabled:opacity-50">Testa</button>
            <button onClick={() => onSync(c)} disabled={busy} className="px-2 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50">Synka nu</button>
          </div>
        </div>
      ))}

      <div className="rounded border border-dashed border-gray-300 dark:border-gray-600 p-2 space-y-2">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-300">Lägg till anslutning</div>
        <input className={inputCls} placeholder="Namn (valfritt)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputCls} placeholder="Värd, t.ex. cloud.exempel.se" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
        <input className={inputCls} placeholder="Användarnamn" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
        <input className={inputCls} type="password" placeholder="App-lösenord" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" />
        <input className={inputCls} placeholder="Mappar (en per rad eller komma), t.ex. Forskning, Anteckningar" value={form.roots} onChange={(e) => setForm({ ...form, roots: e.target.value })} />
        <button onClick={addConnection} className="px-3 py-1.5 rounded bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-sm">Spara anslutning</button>
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
