# Locked project folders — security model

This document is the authoritative description of how **locked notes and locked project
folders** are protected in Noter, across the mobile app, the web/Electron app, the backend,
the AI (chat + agent), and the search/RAG index.

> Hard requirement: **nothing inside a locked project folder may ever leak.** A note inside a
> locked folder is reachable ONLY by the user personally opening that folder and entering its
> password. The AI and the search index must NEVER touch locked content — not even a folder
> the user currently has open.

**Var detta hör hemma i dokumentationen:** master-indexet
[`../../Doc/index.md`](../../Doc/index.md) (§1 nav + invariant §3.6) pekar hit; den
audit-redo liggar-raden är **T20** i [`../../Doc/security/cwe-mapping.md`](../../Doc/security/cwe-mapping.md)
(CWE-200/CWE-359); den smalare "AI läser aldrig låst innehåll"-invarianten finns i
[`../../Doc/security/ai-locked-notes.md`](../../Doc/security/ai-locked-notes.md). Den här filen
är den **auktoritativa** helhetsmodellen — uppdatera den först, spegla sedan liggar-raden.

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

### Auto re-lock on app background / foreground idle (leaving the app = leaving the folder)

`relockProtectedFolders()` (both stores) empties the unlock set and re-masks **all** notes. It
fires in two situations, both in `components/AppLock.tsx`:

1. **App background / tab hidden** — the moment the app is backgrounded (mobile:
   `AppState === 'background'`, gated on true background — not the transient iOS `inactive` of the
   app-switcher peek or a system permission sheet; web/Electron: `document.visibilitychange → hidden`).
2. **Foreground inactivity** — while the app stays open, a 30 s poll calls
   `shouldRelockOnIdle(lastActivityAt, now, thresholdMs)` (`@repo/shared/locks`) and re-locks once
   that idle window elapses. Activity is timestamped by the existing app-lock activity listeners on
   web (`mousedown/keydown/scroll/touchstart`) and by a **non-capturing root responder** on mobile
   (`onStart/onMoveShouldSetResponderCapture` that record the touch and return `false`, so gestures
   pass straight through). The threshold is a **user setting** — "Lås projektmappar efter" in the
   security section of Settings (options `Av / 1 / 5 / 15 / 30 min`, default 5 min) — persisted to
   `localStorage` (web) / `SecureStore` (mobile) under `folderIdleLockMinutes`, read via the shared
   `resolveFolderIdleLockMs` (single source of truth: `FOLDER_IDLE_LOCK_OPTIONS_MIN`; "Av" = 0 = off;
   a tampered/out-of-range value falls back to the default, never widening the window). Web reads it
   every poll tick (instant effect); mobile reads it on mount + each return to foreground.

Both are deliberately **stricter** than the whole-app lock: the app-lock keeps a configurable grace
window (5 min … 12 h) so you don't re-authenticate every time you glance at a notification, but a
password-protected folder is the most sensitive surface and does **not** inherit that grace — it
closes when you leave the app or sit idle in it, without forcing a full app re-auth. The action is a
**no-op** (no re-render) when nothing is unlocked, so it is free on the common path. A full app-lock /
logout still clears the unlock set as before (mobile `setSecurityLocked`, web `setAppLocked`).

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
| GraphQL / AI tool surface | `apps/backend/src/graphql/schema.ts` — `Query.note/notes/task/tasks` gate every read with `isReadableWithLocks` (empty set) via `loadNoteSecurityMap` before decrypting; the always-on `backendAgentRunner` does the same |
| Home-screen widget snapshot | `apps/mobile/services/widgets/snapshotWriter.ts` — `writeWidgetSnapshot` filters tasks + lists with `isReadableForAI` (empty set) before writing the OS-shared-container snapshot |
| Nextcloud outbound push (web) | `apps/web/services/nextcloud.ts` `pushLocalEditsForConnection` skips any note that is not `isReadableForAI` before the WebDAV PUT |

A mechanical guard, `scripts/check-index-unlock-leak.mjs` (blocking in `validate:critical` + CI),
fails if the UI's `unlockedProtectedNoteIds` is ever passed to a known publish/index projection
builder, so this class of leak cannot regress silently.

The agent system prompt also carries `AGENT_LOCK_POLICY` (a firm "never access locked content"
instruction) as defense-in-depth — but the hard guarantee is the empty unlock set + the
filter, not the model's compliance.

## 5a. Single-note export / share (user-initiated)

Exporting or sharing one note (Share-as-PDF / Share-as-Markdown) is a user action, not an
automated reader, so it IS allowed for a note the user has legitimately unlocked. The guarantee
is narrower: a note still blocked by a **locked ancestor** (not unlocked in this session) must
never be serialised to a file or handed to the OS share sheet. Both apps enforce this at runtime,
not just by hiding the menu item:

| App | File | Guard |
|---|---|---|
| Mobile | `apps/mobile/services/noteExport.ts` | `exportNoteToMarkdown` / `exportNoteToPdf` return `{ok:false}` and write/render/share nothing when called with `locked:true` (the editor passes `locked: !!blockingLockedAncestor`). Proven by `__tests__/services/noteExport.test.ts`. |
| Web/Electron | `apps/web/components/NoteEditor.tsx` | `handleExportPDF` / `handleExportMarkdown` refuse early when `isEffectiveLocked && !isUnlockedLocally` (= the same condition that renders the lock screen), so neither reads the live Slate DOM nor saves/downloads a file. |

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

## 8. Framtida härdning / uppgraderingsväg

Skrivet så att en framtida modell/utvecklare kan **höja** skyddet utan att bryta nuvarande
garantier. Varje punkt är additiv — invarianterna i §7 måste fortsatt hålla.

1. **Distinkt nyckel per låst mapp (kryptografisk, inte bara filtrering).** 🟡 **Fas 1 levererad.**
   Beslut + migrationsplan i [`../../Doc/adr/0012-per-folder-encryption.md`](../../Doc/adr/0012-per-folder-encryption.md).
   Krypto-primitiven finns i `packages/shared/src/folderKey.ts` (+ `folderKey.test.ts`, 18 tester i
   den blockerande grinden): varje skyddad mapp får en slumpad **mapp-nyckel** (FK) wrappad under en
   mapp-lösenords-härledd rotnyckel (Argon2id, PBKDF2-fallback) — `createFolderKey` / `unlockFolderKey`
   / `rewrapFolderKey` (lösenordsbyte = re-wrap, ingen om-kryptering). Notfält sealas med
   `wrapNoteForFolder` till ett **`v3f:`**-kuvert som läsvägen kan skilja från `v3:` (under användarens
   `dataKey`) — så befintliga låsta noter förblir läsbara (bakåtkompatibelt, invariant §3 i indexet).
   Två shared-byggstenar är nu levererade: **läs-dispatchen** `materializeFolderField` (`encrypt.ts`,
   dekrypterar ett `v3f:`-fält bara när mappens FK finns, annars mask; `safeDecrypt`/`decrypt`
   returnerar masken aldrig kuvertet om ett `v3f:`-värde råkar nå dem utan FK — defense-in-depth),
   och **FK-sessionen** `folderKeySession.ts` (in-memory-only karta mapp-id→FK, äger en kopia, nollar
   bytena vid omlåsning, töms av `clearAllFolderKeys()` vid app-lås/logout). **Kvar (kommande faser,
   se ADR §Migration):** lagra `FolderKeyBundle` på mappnoten; anropa `unlockFolderKey`→`setFolderKey`
   vid mapp-upplåsning och `materializeFolderField`/`wrapNoteForFolder` med `getFolderKey(folderId)`
   på mappnoten (✅ **mekanismen finns**: `Note.folderKeyBundle?: string` +
   `readFolderKeyBundleFromNote`/`withFolderKeyBundle` i `folderKey.ts`); samt en mekanisk grind som
   håller `v3f:` borta från publicerings-/index-ytor.
   ✅ **Läs-vägen är wired i båda stores:** `materializeOneNote` dispatchar `title`/`content` via
   `materializeFolderField` med `getFolderKey(<närmaste låsta förälder>)` (no-op för all befintlig
   data; test: "materializes a v3f note decrypted with the session folder key, masked without it").
   ✅ **Clear-on-lock är wired:** båda stores tömmer FK-sessionen (`clearAllFolderKeys()`) vid
   app-lås/logout. **Kvar:** enrolment (sätt mapp-lösenord → `createFolderKey` + lagra
   `FolderKeyBundle` på mappnoten + `setFolderKey`) och skriv-vägen (`wrapNoteForFolder`) — de delar
   som *skapar* `v3f:`-noter — **inte** wired ännu (kräver enhets-/runtime-verifiering).
2. **Signerad, read-only widget-/publicerings-endpoint.** Fas 3 i extern-MD-synken. När den
   byggs: håll `isReadableForAI`-filtret (tom upplåsnings­mängd) som det enda urvalet och lägg
   till en kort-livad signatur per snapshot — lägg till en ny `GUARDED`-byggare i
   `scripts/check-index-unlock-leak.mjs` så den nya ytan täcks av samma mekaniska grind.
3. **Audit-logg för upplåsnings-händelser (lokalt, krypterat).** Logga *att* en mapp låstes upp/
   om (tidsstämpel, mapp-id), aldrig innehåll, så användaren kan se sin egen lås-historik. Måste
   följa CWE-532 (inga secrets i loggen) och stanna på enheten.
4. **Auto-omlås vid inaktivitet inuti en mapp** ✅ **klart**. Omlås sker både vid **app-bakgrund**
   och vid **förgrunds-inaktivitet** (en 30 s-poll + `shouldRelockOnIdle`) — se §2. Tröskeln är nu
   en **användarinställning** ("Lås projektmappar efter": `Av / 1 / 5 / 15 / 30 min`, default 5 min)
   i båda apparnas säkerhetsinställningar, sparad som `folderIdleLockMinutes` och tolkad via delade
   `resolveFolderIdleLockMs`. Klart.
5. **Utöka self-testet till nya modaliteter.** När en ny extern yta tillkommer (t.ex. en
   delnings-länk, ett export-format, en ny graf-sink): lägg till dess byggar-namn i `GUARDED` och
   en fixture i `--selftest` *innan* ytan kopplas in — grinden ska fånga läckan dag noll.

> Uppgraderingsregel: ändra `locks.ts` (källan) + dess test först, kör
> `scripts/check-index-unlock-leak.mjs --selftest` + `packages/shared` `locks`-sviten grönt,
> uppdatera sedan T20-liggaren och den här filen i samma commit.

## Related

- `packages/shared/src/locks.ts` (source of truth) and `locks.test.ts`
- `docs/DATABASE_PERSISTENCE_SECURITY.md` (E2E at-rest model)
- [`../../Doc/index.md`](../../Doc/index.md) — master-index (denna modell länkas från §1, §2 och invariant §3.6)
- [`../../Doc/security/cwe-mapping.md`](../../Doc/security/cwe-mapping.md) — **T20** (CWE-200/CWE-359), audit-redo liggar-rad
- [`../../Doc/security/ai-locked-notes.md`](../../Doc/security/ai-locked-notes.md) — smalare AI-läs-invariant
- `scripts/check-index-unlock-leak.mjs` (+`--selftest`) — mekanisk läck-grind (blockerande i CI + `validate-critical`)
