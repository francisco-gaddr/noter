/**
 * Agent memory + planning — how a delegated agent uses its environment as a genuine
 * workspace: specific project folders act as readable MEMORY (their notes are
 * instructions/index/md-style memory), and it plans by creating/ordering tasks in its
 * task-lists. Shared so mobile, Electron and the backend runner all build the same
 * memory context + instructions.
 */
import type { Note } from './types';
import type { AiTaskDelegation } from './agentTasks';
import { normalizeNoteType } from './noteType';

/** Conventional fallback memory project when none is explicitly configured. */
export const AGENT_MEMORY_PROJECT_TITLE = 'AI-agent';

/**
 * The project-folder ids the agent should read as memory: the delegation's explicit
 * `memoryProjectIds` if set, otherwise the conventional "AI-agent" project (when it
 * exists). Returns [] when there is nothing to read.
 */
export const selectAgentMemoryProjectIds = (notes: Note[], delegation?: AiTaskDelegation | null): string[] => {
  const configured = (delegation?.memoryProjectIds || []).filter(Boolean).map(String);
  if (configured.length) {
    const live = new Set((notes || []).map((n) => String(n._id)));
    return configured.filter((id) => live.has(id));
  }
  const conventional = (notes || []).find(
    (n) => normalizeNoteType(n.type) === 'project' && (n.title || '').trim().toLowerCase() === AGENT_MEMORY_PROJECT_TITLE.toLowerCase(),
  );
  return conventional ? [String(conventional._id)] : [];
};

export interface AgentMemoryNote { id: string; title: string; content: string; projectId: string }

/**
 * Collect the memory notes from the configured memory projects (decrypt content
 * before passing notes in). Capped so a big folder can't blow the prompt.
 */
export const collectAgentMemoryNotes = (
  notes: Note[],
  delegation?: AiTaskDelegation | null,
  maxNotes = 40,
): AgentMemoryNote[] => {
  const projectIds = new Set(selectAgentMemoryProjectIds(notes, delegation));
  if (projectIds.size === 0) return [];
  const out: AgentMemoryNote[] = [];
  for (const n of notes || []) {
    if (n.deleted === true || n.deleted === 'true') continue;
    if (!n.parentId || !projectIds.has(String(n.parentId))) continue;
    if (normalizeNoteType(n.type) !== 'note') continue; // memory entries are notes, not sub-folders/lists
    out.push({ id: String(n._id), title: (n.title || '').trim() || '(namnlös)', content: (n.content || ''), projectId: String(n.parentId) });
    if (out.length >= maxNotes) break;
  }
  return out;
};

/** Render the memory block for the system prompt (or '' when empty). */
export const renderAgentMemoryBlock = (memory: AgentMemoryNote[], perNoteChars = 600): string => {
  if (!memory.length) return '';
  const lines = memory.map((m) => `- ${m.title}: ${(m.content || '').slice(0, perNoteChars)}`);
  return `\nMinnen/index/instruktioner (dina minnesmappar):\n${lines.join('\n')}`;
};

/**
 * Static guidance teaching the agent how to use its environment: memory folders,
 * planning via its own tasks with order/priority, and staying transparent. Appended to
 * every agent system prompt.
 */
export const AGENT_PLANNING_INSTRUCTIONS = [
  'Så här använder du din omgivning:',
  '- Minne: anteckningarna i dina minnesmappar (ovan) är dina bestående minnen, regler och index. Läs dem (get_note/list_notes) innan du planerar, och uppdatera dem (update_note/create_note) när du lärt dig något som ska bestå till nästa körning.',
  '- Planering: bryt ner målet i konkreta steg och skapa uppgifter (create_task) i en passande uppgiftslista — sätt dueDate för ordning och priority (low/medium/high) för vad som är viktigast. Bocka av (complete_task) när ett steg är klart, så att du och användaren kan följa förloppet.',
  '- Ordning & prioritet: arbeta i prioritets- och tidsordning; uppdatera planen när läget ändras.',
  '- Transparens: använd alltid riktiga tool calls för det du läser/ändrar så att varje steg syns tydligt för användaren — gissa eller hitta inte på innehåll du inte läst.',
].join('\n');
