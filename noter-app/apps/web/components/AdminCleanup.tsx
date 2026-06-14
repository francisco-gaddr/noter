'use client';
/**
 * Admin cleanup — bulk-remove the junk that accumulates: empty notes, titleless
 * tasks and completed tasks. Uses the shared cleanupCandidates selector so mobile
 * + web offer identical categories. Lists are scrollable so nothing is hidden.
 */
import React, { useMemo, useState } from 'react';
import { cleanupCandidates } from '@repo/shared';
import { useStore } from '../stores/useStore';

const Row: React.FC<{
  title: string;
  items: { _id: string; title?: string }[];
  busy: boolean;
  onClear: () => void;
}> = ({ title, items, busy, onClear }) => (
  <div className="border border-gray-200 dark:border-gray-700 rounded p-2">
    <div className="flex items-center justify-between mb-1">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{title} ({items.length})</span>
      {items.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-red-600 text-white disabled:opacity-50"
        >
          Rensa {items.length}
        </button>
      )}
    </div>
    {items.length > 0 && (
      <div className="max-h-40 overflow-y-auto text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
        {items.map((i) => <div key={i._id} className="truncate">• {i.title?.trim() || '(tomt)'} <span className="opacity-50">{i._id.slice(0, 8)}</span></div>)}
      </div>
    )}
  </div>
);

export const AdminCleanup: React.FC = () => {
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const deleteNote = useStore((s) => s.deleteNote);
  const deleteTask = useStore((s) => s.deleteTask);
  const [busy, setBusy] = useState(false);

  const c = useMemo(() => cleanupCandidates(notes as any, tasks as any), [notes, tasks]);

  const clear = async (kind: 'emptyNotes' | 'blankTasks' | 'completedTasks' | 'all') => {
    const noteIds = kind === 'emptyNotes' || kind === 'all' ? c.emptyNotes.map((n) => n._id) : [];
    const taskIds = [
      ...(kind === 'blankTasks' || kind === 'all' ? c.blankTasks.map((t) => t._id) : []),
      ...(kind === 'completedTasks' || kind === 'all' ? c.completedTasks.map((t) => t._id) : []),
    ];
    if (noteIds.length + taskIds.length === 0) return;
    if (!confirm(`Ta bort ${noteIds.length + taskIds.length} objekt? Detta går inte att ångra.`)) return;
    setBusy(true);
    try {
      for (const id of taskIds) await deleteTask(id);
      for (const id of noteIds) await deleteNote(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800" data-testid="admin-cleanup">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100">Städning ({c.total})</h3>
        {c.total > 0 && (
          <button type="button" onClick={() => clear('all')} disabled={busy} className="text-xs px-2 py-1 rounded bg-red-700 text-white disabled:opacity-50">
            Rensa allt ({c.total})
          </button>
        )}
      </div>
      {c.total === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Inget att städa — allt är rent.</p>
      ) : (
        <div className="space-y-2">
          <Row title="Tomma anteckningar" items={c.emptyNotes} busy={busy} onClear={() => clear('emptyNotes')} />
          <Row title="Titellösa uppgifter" items={c.blankTasks} busy={busy} onClear={() => clear('blankTasks')} />
          <Row title="Klara uppgifter" items={c.completedTasks} busy={busy} onClear={() => clear('completedTasks')} />
        </div>
      )}
    </div>
  );
};

export default AdminCleanup;
