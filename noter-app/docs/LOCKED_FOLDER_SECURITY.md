# Locked project folders — security model

This document is the authoritative description of how **locked notes and locked project
folders** are protected in Noter, across the mobile app, the web/Electron app, the backend,
the AI (chat + agent), and the search/RAG index.

> Hard requirement: **nothing inside a locked project folder may ever leak.** A note inside a
> locked folder is reachable ONLY by the user personally opening that folder and entering its
> password. The AI and the search index must NEVER touch locked content — not even a folder
> the user currently has open.

## 1. What "locked" means

A note/folder is **lock-protected** when it has a truthy `locked` flag **or** a non-empty
`password`. This is `hasLockSignal(note)` in `packages/shared/src/locks.ts` — the single
source of truth. Locking is **hierarchical**: a note inside a locked folder is itself
unreadable, transitively up the whole `parentId` chain.

`type` / `locked` / `password` and all content (`title`, `content`, `tags`, …) are stored
**E2E-encrypted** at rest (the backend is zero-knowledge — see `DATABASE_PERSISTENCE_SECURITY.md`).
The lock check is therefore enforced on the **client** after decryption, and conservatively on
the backend using only the lock signal (no decryption).

## 2. The unlock session (UI only)

When the user opens a locked folder and enters the correct password, the folder's id is added
to the **in-memory** unlock set `unlockedProtectedNoteIds` (mobile + web stores). This set:

- is **never persisted** (not in AsyncStorage / localStorage / IndexedDB) — a fresh launch
  starts fully locked;
- is **cleared on logout and on app-lock** (background timeout / manual lock);
- is **scoped to the UI view only** — it is NEVER handed to the AI or the index (see §5).

### Auto re-lock on leave (the key guarantee)

`setActiveProject(id)` (both stores) calls `relockFoldersOnLeave(notes, unlockedIds, id)`
(`packages/shared/src/locks.ts`). It keeps unlocked **only** the folders on the path to the
folder you are entering (the active folder + its ancestors) and **re-locks every folder you
navigated away from**, then re-materializes the notes so the masking takes effect immediately.

Concretely:

- Leave a folder → back to all-notes (`id = null`): **every** folder re-locks.
- Switch from folder A to sibling C: A re-locks (C was just unlocked to enter).
- Go from A into its subfolder B: A (ancestor) + B stay unlocked.

So a folder is open only while you are inside it; the moment you leave, the password is
required again. Individually-unlocked **non-folder** notes are left untouched by this step (a
single opened note re-masks anyway as soon as its containing folder re-locks).

## 3. Display filtering (notes never leak into general views)

Every list/surface filters with `isReadableWithLocks(note, noteMap, unlockedIds)` (= the whole
ancestor chain is unlocked):

| Surface | File | Behaviour |
|---|---|---|
| Notes list (mobile) | `apps/mobile/app/(tabs)/index.tsx` | excludes any note blocked by a locked ancestor |
| Sidebar/notes tree (web) | `apps/web/components/SidebarTree.tsx` | same; a locked **folder row** is shown (title only) so it can be tapped to unlock |
| Search | mobile `search.tsx`, web Fuse in SidebarTree | filtered by `isReadableWithLocks` |
| Graph explorer | mobile `graph.tsx`, web `GraphExplorer.tsx` | locked notes/tasks never become nodes |
| Tasks | mobile `tasks.tsx`, web tasks view | a task under a locked list is hidden |

Decryption itself is gated: `materializeOneNote` / `materializeNotesFromEncrypted` **mask**
(blank title/content/tags) any note blocked by a locked ancestor, while preserving the raw
ciphertext (`__rawEncryptedTitle`, …) so it can be re-revealed after a correct unlock.

## 4. Backend (zero-knowledge, no unlock session)

The backend cannot decrypt and has **no** unlock session, so it treats **any** lock signal as
locked. `apps/backend/src/services/backendAgentRunner.ts` calls `isReadableWithLocks(...)` with
the default **empty** unlock set ("unlockedIds is empty here, by design") — the always-on
backend agent can never read a locked note. The unlock endpoint verifies the password and
returns content only for the matching note.

## 5. AI + indexing NEVER see locked content (even if the UI unlocked it)

This is the strict invariant: **a folder's UI unlock is a view-only grant and is never extended
to automated readers.** The shared module exports the empty-by-construction set and helpers:

```ts
// packages/shared/src/locks.ts
export const AI_INDEX_NO_UNLOCK: ReadonlySet<string> = Object.freeze(new Set<string>());
export const filterReadableForAI = (notes) => filterReadableNotes(notes, AI_INDEX_NO_UNLOCK);
export const isReadableForAI   = (note, map) => isReadableWithLocks(note, map, AI_INDEX_NO_UNLOCK);
```

Every AI/index entry point passes the **empty** unlock set, so a lock-signalled note/folder is
invisible regardless of what the user currently has open:

| Path | File |
|---|---|
| Chat tool guards (read/list/get) | mobile `app/(tabs)/ai.tsx` `getAISecurityContext`; web `components/AISidebar.tsx` `getAISecurityContext` |
| Delegated/scheduled agent | mobile + web `services/ai/agentExecutor.ts` (both contexts) |
| AI note/task placement | mobile + web `services/ai/placement.ts` (`readableContainers`) |
| RAG retrieval for chat | `retrieveForChat(...)` call in `ai.tsx` / `AISidebar.tsx` |
| Vector/embeddings index build | `EmbeddingsSettings.tsx` (both apps) + web `services/nextcloud.ts` → `indexEntities(... new Set())` |
| GraphRAG neighbour hop | `services/ai/embeddingsService.ts` — neighbours constrained to the lock-filtered candidate set so a graph hop can't surface a locked note |
| External Neo4j graph sync | `packages/shared/src/neo4jSync.ts` — `buildNeo4jSyncPlan` takes **no** unlock-set argument (hard-wired empty), so a locked folder is never mirrored to the user's Neo4j even while open in the UI; `web services/nextcloud.ts` calls it with no unlock set |
| Agent memory injection | `agentExecutor.ts` → `collectAgentMemoryNotes(notes, …, emptyUnlock)` |

The agent system prompt also carries `AGENT_LOCK_POLICY` (a firm "never access locked content"
instruction) as defense-in-depth — but the hard guarantee is the empty unlock set + the
filter, not the model's compliance.

## 6. Tests

- `packages/shared/src/locks.test.ts` — hierarchical readability, `filterReadableForAI` /
  `isReadableForAI` (drop locked even when a UI set would unlock), and `relockFoldersOnLeave`
  (all-notes re-locks everything; ancestors kept; sibling switch re-locks; non-folder notes
  untouched).

## 7. Threat model / what is guaranteed

- A note inside a locked folder is **not** in the all-notes list, search, graph, tasks, the AI
  context, or the search index — until the user opens the folder with the password.
- Leaving the folder (navigating away) **immediately re-locks** it.
- The AI/agent/index can never read locked content, even momentarily-unlocked-in-UI content.
- On app-lock / logout / relaunch the unlock session is gone and everything is locked again.

## Related

- `packages/shared/src/locks.ts` (source of truth) and `locks.test.ts`
- `docs/DATABASE_PERSISTENCE_SECURITY.md` (E2E at-rest model)
