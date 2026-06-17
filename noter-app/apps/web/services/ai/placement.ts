/**
 * Web/Electron parity with the mobile placement helper: decide where an AI-created NOTE or TASK
 * should land. Shared by the chat tool executor and the delegated-agent executor.
 *
 * Order (notes):  explicit parentId → the folder the user is currently in → best-matching project
 *                 folder (title overlap) → a default, clearly-AI-named folder (find-or-create).
 * Order (tasks):  explicit parentNoteId → best-matching task list → default AI task list.
 *
 * SECURITY: only ever considers UNLOCKED, readable containers (never places into / creates under a
 * locked folder), mirroring the AI lock guard.
 */
import { useStore } from '../../stores/useStore';
import {
  buildSecurityNoteMap,
  isReadableWithLocks,
  normalizeNoteType,
  pickBestContainer,
  AI_DEFAULT_NOTE_FOLDER_TITLE,
  AI_DEFAULT_TASKLIST_TITLE,
  type Note,
} from '@repo/shared';

const readableContainers = (type: 'project' | 'task_list'): { id: string; title: string }[] => {
  const store: any = useStore.getState();
  const all: Note[] = Array.isArray(store.notes) ? store.notes : [];
  const unlocked = new Set<string>(store.unlockedProtectedNoteIds || []);
  const map = buildSecurityNoteMap(all as any);
  return all
    .filter(
      (n: any) =>
        !n.deleted &&
        normalizeNoteType(n.type) === type &&
        isReadableWithLocks(n as any, map as any, unlocked),
    )
    .map((n) => ({ id: n._id, title: n.title || '' }));
};

const findOrCreateDefault = async (
  type: 'project' | 'task_list',
  defaultTitle: string,
): Promise<string | null> => {
  const store: any = useStore.getState();
  const existing = readableContainers(type).find(
    (c) => (c.title || '').trim().toLowerCase() === defaultTitle.toLowerCase(),
  );
  if (existing) return existing.id;
  try {
    await store.createNote(defaultTitle, null, type);
    // createNote returns void on web; re-read the store to find the new container by title.
    const made = readableContainers(type).find(
      (c) => (c.title || '').trim().toLowerCase() === defaultTitle.toLowerCase(),
    );
    return made?.id || null;
  } catch {
    return null; // fall back to root rather than fail the whole tool call
  }
};

/** Resolve the parentId for an AI-created note. */
export const resolveAiNoteParentId = async (args: Record<string, any>): Promise<string | null> => {
  if (args?.parentId) return String(args.parentId);
  const store: any = useStore.getState();
  // Strong contextual default: the folder the user is currently looking at.
  if (store.activeProjectId) return String(store.activeProjectId);
  const text = `${args?.title || ''} ${args?.content || ''}`;
  const best = pickBestContainer(text, readableContainers('project'));
  if (best) return best;
  return findOrCreateDefault('project', AI_DEFAULT_NOTE_FOLDER_TITLE);
};

/** Resolve the parentNoteId (task list) for an AI-created task. */
export const resolveAiTaskParentId = async (args: Record<string, any>): Promise<string | null> => {
  if (args?.parentNoteId) return String(args.parentNoteId);
  const text = `${args?.title || ''} ${args?.description || ''}`;
  const best = pickBestContainer(text, readableContainers('task_list'));
  if (best) return best;
  return findOrCreateDefault('task_list', AI_DEFAULT_TASKLIST_TITLE);
};
