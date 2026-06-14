'use client';
/**
 * Reusable "Länka till andra (graf)" picker — search notes/projects/lists/tasks and
 * toggle explicit graph links (EntityLink) on the current entity. Self-contained: give
 * it the current links + an onChange and it renders the chips + search. Used by the
 * note editor and (can be adopted by) the task modal.
 */
import React, { useState } from 'react';
import { toggleEntityLink, normalizeNoteType, type EntityLink } from '@repo/shared';
import { useStore } from '../stores/useStore';

const KIND_ICON: Record<string, string> = { project: '📁', task_list: '✓', task: '◻︎', note: '📝' };

export const EntityLinkPicker: React.FC<{
  selfId?: string;
  links: EntityLink[];
  onChange: (links: EntityLink[]) => void;
}> = ({ selfId, links, onChange }) => {
  const notes = useStore((s) => s.notes) as any[];
  const tasks = useStore((s) => s.tasks) as any[];
  const [query, setQuery] = useState('');

  const candidates = [
    ...(notes || []).map((n) => ({ id: n._id, label: n.title, kind: normalizeNoteType(n.type) })),
    ...(tasks || []).map((t) => ({ id: t._id, label: t.title, kind: 'task' as const })),
  ].filter((c) => c.id && c.id !== selfId);

  return (
    <div data-testid="entity-link-picker">
      <label className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Länka till andra (graf)</label>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1 my-1">
          {links.map((l) => {
            const tgt = candidates.find((c) => c.id === l.targetId);
            return (
              <button key={l.targetId} type="button" onClick={() => onChange(toggleEntityLink(links, l.targetId))} className="text-[11px] px-2 py-0.5 rounded-full bg-pink-600 text-white">
                {(tgt?.label || l.targetId.slice(0, 6))} ✕
              </button>
            );
          })}
        </div>
      )}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sök att länka…" className="w-full border rounded p-1.5 text-sm dark:bg-gray-900 dark:border-gray-700" />
      {query.trim() && (
        <div className="max-h-40 overflow-y-auto mt-1 border border-gray-200 dark:border-gray-700 rounded">
          {candidates.filter((c) => (c.label || '').toLowerCase().includes(query.toLowerCase())).slice(0, 20).map((c) => {
            const on = links.some((l) => l.targetId === c.id);
            return (
              <button key={c.id} type="button" onClick={() => onChange(toggleEntityLink(links, c.id))} className={`w-full text-left px-2 py-1 text-xs ${on ? 'bg-pink-50 dark:bg-pink-900/30' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <span className="text-gray-400 mr-1">{KIND_ICON[c.kind] || '📝'}</span>
                {c.label || '(namnlös)'} {on ? '✓' : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EntityLinkPicker;
