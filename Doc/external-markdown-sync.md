# External Markdown Sync — serve selected notes/folders as a secure, two-way MD vault

> **STATUS: IMPLEMENTED — Phase 1 (WebDAV) + Phase 2 (CRDT Live) both shipped
> 2026-06-16.** Both transports are live, gated per-share in app settings (mobile +
> Electron/web), E2E-preserving (only the opted-in, unlocked subset is projected), with
> instant revoke and an operator kill-switch. Decision record:
> [`adr/0008-external-markdown-sync.md`](./adr/0008-external-markdown-sync.md) (Accepted).
> Real files are linked in §"Status per phase". Tests run in CI via
> `scripts/validate-critical.mjs` (shared `markdownVault`/`markdownLive` + backend
> `__tests__/markdav.test.ts`).

Goal: let the user expose **specific notes and project-folders** as a **Markdown vault**
that external tools — **Obsidian**, **macOS apps / Finder**, **Android apps**, and our own
**widgets** — can read *and write*, with **real-time two-way sync**, **per-item opt-in**,
and **instant revoke** from in-app settings. Everything not explicitly shared stays
**fully end-to-end encrypted and never leaves the device/server as plaintext**.

This is, deliberately, the **Markdown/files twin of the [CalDAV bridge](./caldav-bridge.md)**:
same projection + mutation-drain + per-share-credential + kill-switch architecture, applied
to note *files* instead of `VTODO` tasks. Reusing that proven pattern is what makes this
secure, self-healing, and low-risk.

---

## 1. The hard constraint (why a naïve "MD server" is wrong)

Noter is **end-to-end encrypted** (v3 AES-GCM + Argon2id, see
[`security/encryption-review-2026-06.md`](./security/encryption-review-2026-06.md)). The
server (Pi/Mongo) stores **ciphertext only** and holds **no key**. So the backend
*cannot* read a note to render it as Markdown, nor write one from an inbound edit. Any
design that "just serves the notes as files from the server" would require the server to
hold plaintext / a key for **all** notes — breaking E2E for the entire account.

The resolution is the same one the CalDAV bridge uses, and it is the whole point of the
security model: **only the explicitly-shared subset is ever projected to plaintext**, by
the *client* (which has the key), into a server-side store that exists **solely** for that
share. The rest of the account is never touched.

> Precedent: `buildSafeCalendarProjection` already does exactly this for tasks, and is
> **lock-aware** (locked lists are never projected). The Markdown projection reuses the
> same guard so **locked notes/projects are never exposed**, ever.

---

## 2. Evaluation — what is the best, most modern approach (June 2026)

Researched the current self-hosted / Obsidian-compatible sync landscape. Summary of the
viable mechanisms and the verdict for *our* constraints (selective, E2E-preserving,
revocable, multi-client incl. non-Obsidian + widgets):

| Approach | Real-time | Clients it reaches | Conflict handling | Fit for *selective + E2E + revoke* | Verdict |
|---|---|---|---|---|---|
| **WebDAV Markdown vault** (Obsidian *Remotely Save*, Finder mount, Android WebDAV apps) | Near (poll + push nudge) | **Broadest** — Obsidian, macOS, Android, widgets | Last-writer-wins + conflict copy | **Excellent** — maps 1:1 onto our CalDAV per-share creds + projection + mutation queue | **Phase 1 baseline** ✅ |
| **CRDT live layer** (Yjs / Automerge / Loro; the engine behind Obsidian *Relay*) | **Keystroke-level, true real-time** | Our own apps + a thin Obsidian companion; not generic file apps | **Automatic, conflict-free merge** (offline-merge, multi-writer) | Good, but needs a per-share CRDT room + bridge; not a plain-files protocol | **Phase 2 real-time upgrade** ✅ |
| **CouchDB + Obsidian LiveSync** (PouchDB↔CouchDB replication, chunked E2EE) | Near real-time | **Obsidian only** | CouchDB revisions / replication | Per-share CouchDB DB is a clean scope+revoke boundary, but Obsidian-only and our Mongo notes must be bridged to CouchDB doc schema | **Phase 2 alternative** (Obsidian-centric users) |
| **Git** (Obsidian Git plugin) | No (manual/interval) | Obsidian, anything with git | Merge conflicts (manual) | Poor — not real-time, conflict-prone, exposes history | ❌ not chosen |
| **S3/object storage** (Remotely Save S3) | No (interval) | Obsidian, scripts | File-level overwrite | OK but no native real-time, extra infra | ❌ not primary |

**Modern context (2026):** the state of the art for *real-time collaborative Markdown* is
**CRDT-based, local-first** sync (Yjs is the dominant, fastest, network-agnostic engine;
Automerge = JSON/Git-like history; Loro = newer). Obsidian's leading multiplayer plugin
**Relay** is built exactly on this (keystroke-level CRDT, live cursors, offline merge).
For *broad file compatibility* (non-Obsidian apps, widgets), **WebDAV** remains the
universal lingua franca, and **Obsidian LiveSync (CouchDB)** is the proven self-hosted
near-real-time option *within* Obsidian.

**Decision: layered.** Ship the **WebDAV Markdown vault** first (universal reach, reuses
our entire CalDAV stack, secure + revocable today), then add a **CRDT (Yjs) "Live" mode**
as an opt-in upgrade for true real-time. This gets the broadest, safest coverage now and
the most-modern real-time experience next — without betting the security model on a single
third-party ecosystem. Full rationale + alternatives in
[`adr/0008-external-markdown-sync.md`](./adr/0008-external-markdown-sync.md).

Sources (June 2026): Obsidian Self-hosted LiveSync
(<https://github.com/vrtmrz/obsidian-livesync>), Relay multiplayer
(<https://relay.md/>, <https://github.com/No-Instructions/Relay>), Remotely Save WebDAV
(community plugin), Yjs (<https://yjs.dev/>), Automerge/Loro CRDT comparison
(<https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026>), CRDT
real-time overview (<https://velt.dev/blog/best-crdt-libraries-real-time-data-sync>).

---

## 3. Architecture (Phase 1 — the WebDAV Markdown vault)

```
Obsidian (Remotely Save) / Finder mount / Android WebDAV / Widget
        │  GET/PROPFIND/REPORT  ◀── renders .md files from MarkdownShare.files (plaintext projection)
        │  PUT/DELETE/MKCOL/MOVE ──▶ enqueues { path, op, contentRef } in pendingFileMutations
                                                  │
Noter app ──GET /api/md/mutations────────────────┘  parse MD→note, apply with the user's key,
        └──re-push projection──▶ socket 'markdown:mutation' nudges live clients to re-pull
```

A **MarkdownShare** is a scope = a SET of project-folders and/or individual notes the user
opted in. It owns:
- a **plaintext file projection** (`files: [{ path, frontmatter, body, etag, updatedAt }]`)
  pushed by the client — the *only* place those notes exist as plaintext server-side;
- a **per-share WebDAV credential** (`davUser` + `davTokenHash`, exactly like CalDAV);
- a **`pendingFileMutations`** queue for inbound external edits (dedup per `path`, capped).

### Outbound (app → external), near real-time
1. A shared note changes locally → client re-projects **only the changed files** (diff by
   etag/hash) and `PUT`s them to the share.
2. Backend stores the projection and bumps the collection **ctag**; emits socket
   `markdown:mutation` to the user's other live clients.
3. WebDAV clients see the change on their next `PROPFIND`/`sync-collection` (Obsidian
   Remotely Save polls; Finder on refresh). A short poll + the ctag make this feel live;
   the CRDT Live mode (Phase 2) makes it keystroke-instant.

### Inbound (external → app), two-way
1. An external app `PUT`s/`DELETE`s/`MOVE`s a `.md` file. The backend **cannot decrypt**,
   so it records a non-sensitive **mutation intent** `{ path, op, contentRef }` in
   `pendingFileMutations` (the new MD body is stored transiently in the share's projection
   slot, which is already an opted-in plaintext store — no *new* exposure).
2. The Noter app drains `GET /api/md/mutations`, **parses the Markdown → note** (frontmatter
   → metadata, body → content, `[[wikilinks]]` → entity links), applies it to the real
   **encrypted** note **with the user's key**, acks it, and re-pushes the projection.
3. Eventually-consistent (bounded by the client's drain cadence + the `markdown:mutation`
   nudge), E2E fully intact — **the server never sees a key**.

### Data mapping (Noter note ↔ `.md` file) — Obsidian-friendly
| Noter | Markdown file |
|---|---|
| Project-folder (`type:'project'`) | a **directory** |
| Note (`type:'note'`) | `<slug>.md` inside its folder |
| note `_id` / `clientId` | `id:` in YAML frontmatter (stable join key, like `UID`) |
| title | `# <title>` (H1) **and** `title:` frontmatter |
| content | the Markdown body |
| tags | `tags: [...]` frontmatter |
| createdAt / updatedAt | `created:` / `updated:` frontmatter (ISO) |
| entity links (`[[id]]`) | Obsidian `[[wikilinks]]` (resolved by title on the way in) |
| task_list / tasks | rendered as a `- [ ]` / `- [x]` checklist section (read-mostly v1) |

A `packages/shared/src/markdownVault.ts` is the **single source** for note↔MD
serialize/parse (dependency-free, unit-tested), the twin of `caldav.ts`.

---

## 4. Phase 2 — real-time "Live" mode (CRDT, opt-in upgrade)

For true keystroke-level real-time (the 2026 state of the art), add an opt-in **Live**
toggle per share backed by a **Yjs CRDT** document room:
- A `y-websocket`/Hocuspocus-style server (can run in the same backend process, authed by
  the share credential) holds one **Y.Doc per shared note**, scoped to the share room.
- Our apps bind their editor to the Y.Doc (conflict-free multi-writer, offline merge,
  live cursors). A thin Obsidian companion plugin (or reuse **Relay**'s model) can join
  the same room. The server **persists** the Y.Doc and bridges it to the encrypted note
  store (debounced: CRDT update → re-encrypt → save; note change → apply to Y.Doc).
- **Alternative for Obsidian-native users:** expose a **per-share CouchDB database** and
  let them use the mature **Obsidian LiveSync** plugin; the backend bridges the CouchDB
  `_changes` feed ↔ the note store. CouchDB handles replication/conflict/self-heal
  natively. Chosen per-user; not the default because it's Obsidian-only and adds CouchDB.

Live mode is **strictly additive**: WebDAV (Phase 1) keeps working for non-CRDT clients
and as the durable fallback.

---

## 5. Security model (must-haves)

Mirrors the CalDAV bridge security model exactly, plus the file specifics:

- **E2E preserved by construction.** Only opted-in notes are decrypted (client-side) and
  projected. Non-shared notes are never read/exposed. **Locked notes/projects are never
  projected** (reuse the lock guard; same invariant as AI-locked-notes &
  `buildSafeCalendarProjection`). See [`security/ai-locked-notes.md`](./security/ai-locked-notes.md).
- **Per-share capability credential**, never the account password. `davUser` =
  non-secret lookup (`noter-md-<hex>`); password = ~192-bit secret shown **once**, stored
  only as a hash (`SHA-256`/Argon2id), constant-time verified, per-IP throttled. One
  credential ↔ exactly one `MarkdownShare` scope; cross-scope access → 403.
- **Instant revoke** from settings → clears the credential + drops the queue + (Live)
  closes the CRDT room → next request 401s. Revoking one share never affects others or
  the CalDAV/ICS channels.
- **Per-item granularity** — a share is an explicit set of folders/notes; adding a note to
  a shared folder projects it outward automatically; removing it (or un-sharing) stops the
  projection and deletes the server-side plaintext for it.
- **Operator kill-switch** — `MARKDOWN_SYNC_ENABLED=0` makes the channel 404 + refuses new
  mints (parity with `CALENDAR_CALDAV_ENABLED`). Live state surfaced at
  `GET /api/health/deep → markdownExposure`. Add a row to the egress map in
  [`security/calendar-exposure.md`](./security/calendar-exposure.md).
- **Transport** TLS-only at the edge (daylited.com → Pi); the `/api/md` DAV router runs
  before browser middleware with its own Basic-Auth + raw-body parsing (like `/api/dav`).
  Optional bearer/mTLS for the widget REST.
- **Audit + abuse control** — per-share request log + rate limit; repeated auth failure →
  auto-throttle; size caps on files + queue (capped at 500, like `pendingMutations`).
- **No secret logging** (`sanitizeLogInfo`, CWE-532).

---

## 6. Self-heal, fallbacks, stability (2-way robustness)

Reuse the patterns already battle-tested in the offline-sync-queue
([`adr/0004-offline-sync-queue.md`](./adr/0004-offline-sync-queue.md)) and the CalDAV
drain (incl. the recent **per-uid mutation dedup** + empty-item guard):

- **Mutation dedup per path** (collapse repeated external PUTs of the same file → latest
  wins) — directly mirrors the CalDAV `enqueueMutation` dedup fix.
- **Attempt caps + exponential backoff** on the client drain; a poisoned mutation is
  parked, not retried forever.
- **Drift reconciliation** — collection **ctag** + per-file **etag/sha**; on mismatch the
  client does a **full re-projection** of the share (self-heal to a known-good state).
- **Conflict resolution** — WebDAV: last-writer-wins + a **conflict copy**
  (`<note> (conflict 2026-06-16).md`) so no edit is silently lost; Live/CRDT: automatic
  merge (no conflicts by construction).
- **Offline-first** — external edits queue server-side until the app next drains; local
  edits queue on-device until connectivity returns (existing offline queue).
- **Idempotent + bounded** — every op keyed by stable `id`/`path`; queues capped; periodic
  compaction.

---

## 7. Client UX (revoke + opt-in lives in settings)

- **Per note / per folder "Synka externt (Markdown)" toggle** — in the note/folder context
  menu and in **Settings → External sharing**. Toggling on adds it to a MarkdownShare (or
  creates one); toggling off removes it + purges its server-side plaintext.
- **Share management screen** (twin of the CalDAV/ICS share UI): list shares, the WebDAV
  URL + credential (password shown once / rotate), a **Live mode** switch (Phase 2), and a
  prominent **Revoke** action. Shows what's currently exposed (count of notes/folders).
- **Setup hints** for Obsidian (Remotely Save → WebDAV URL + creds), macOS Finder (Connect
  to Server → the WebDAV URL), Android (a WebDAV file app), and widgets (auto-scoped).
- A persistent, honest **"X notes are shared externally"** indicator (egress transparency).

---

## 8. Proposed surfaces (names mirror CalDAV for consistency)

- **Shared core:** `packages/shared/src/markdownVault.ts` (note↔MD serialize/parse,
  frontmatter, wikilinks, slugging) — dependency-free, unit-tested.
- **Backend model:** `MarkdownShare` (twin of `CalendarFeed`): `userId`, `scope`
  (`folderIds[]`, `noteIds[]`), `files[]` (projection), `davUser`/`davTokenHash`,
  `pendingFileMutations[]`, `live` (bool), lifecycle. Reconcile indexes at boot.
- **Backend DAV server:** `apps/backend/src/markdav/server.ts` mounted at `/api/md`
  (PROPFIND/REPORT/GET/PUT/DELETE/MKCOL/MOVE) — twin of `caldav/server.ts`. `/api/md`
  rides the existing edge `/api/*` proxy (no new edge rule); add a `/.well-known/*`
  redirect only if a client needs discovery.
- **Backend REST:** `/api/md/shares` (CRUD), `/api/md/shares/:id/dav` (mint/rotate/revoke
  credential), `/api/md/mutations` + `/ack` (drain), all **Bearer JWT, userId-scoped**
  (IDOR rule §3 of the index).
- **Clients:** `services/markdownShare.ts` (mobile + web) — push projection, drain
  mutations, manage shares; Settings UI; the per-item toggle.
- **Live (Phase 2):** a Yjs room server module + editor bindings; optional CouchDB bridge.

---

## 9. Status per phase

- [x] **Phase 0 — design sign-off** (this doc + ADR-0008).
- [x] **Phase 1 — WebDAV Markdown vault** — shipped 2026-06-16. Files:
  - Shared core: [`packages/shared/src/markdownVault.ts`](../noter-app/packages/shared/src/markdownVault.ts) + [`markdownVault.test.ts`](../noter-app/packages/shared/src/markdownVault.test.ts) (note↔MD, lock-aware projection, traversal-safe paths, etag).
  - Backend model: [`apps/backend/src/models/MarkdownShare.ts`](../noter-app/apps/backend/src/models/MarkdownShare.ts); WebDAV server [`apps/backend/src/markdav/server.ts`](../noter-app/apps/backend/src/markdav/server.ts) at `/api/md`; REST [`apps/backend/src/routes/markdownShares.ts`](../noter-app/apps/backend/src/routes/markdownShares.ts) at `/api/markdown`; kill-switch [`apps/backend/src/config/markdownExposure.ts`](../noter-app/apps/backend/src/config/markdownExposure.ts); integration tests [`apps/backend/__tests__/markdav.test.ts`](../noter-app/apps/backend/__tests__/markdav.test.ts).
  - Clients: [`apps/mobile/services/markdownShare.ts`](../noter-app/apps/mobile/services/markdownShare.ts), [`apps/web/lib/markdownShare.ts`](../noter-app/apps/web/lib/markdownShare.ts); Settings UI [`MarkdownSharesSettings.tsx`](../noter-app/apps/mobile/components/MarkdownSharesSettings.tsx) (mobile) + [web](../noter-app/apps/web/components/MarkdownSharesSettings.tsx) — per-folder/per-note opt-in, WebDAV/Live mode + outbound/inbound direction checkboxes, credential rotate/revoke.
- [x] **Phase 2 — CRDT Live mode** — shipped 2026-06-16. Yjs rooms relayed over the
      existing JWT-authed socket.io (no extra server). Files:
  - Shared CRDT core: [`packages/shared/src/markdownLive.ts`](../noter-app/packages/shared/src/markdownLive.ts) + [`markdownLive.test.ts`](../noter-app/packages/shared/src/markdownLive.test.ts) (Y.Doc per note, minimal-splice reconcile, origin-tagged updates, concurrent-merge proof).
  - Backend relay: [`apps/backend/src/markdav/live.ts`](../noter-app/apps/backend/src/markdav/live.ts) (per-(share,note) authoritative Y.Doc, owner-JWT-or-CRDT-token auth, debounced persist into the projection + durable upsert mutation).
  - Clients: [`apps/web/lib/markdownLive.ts`](../noter-app/apps/web/lib/markdownLive.ts) + [`apps/mobile/services/markdownLive.ts`](../noter-app/apps/mobile/services/markdownLive.ts) (`useMarkdownLiveSync`, content-level / editor-agnostic).
- [ ] **Phase 3 — widget read endpoint** (scoped, signed, read-only MD). _Not yet started._

Each phase gates on: `node noter-app/scripts/validate-critical.mjs` green (now including
the backend `markdav` integration suite + shared `markdownVault`/`markdownLive`), the IDOR
route-scoping check, the lock-never-projected test (`markdownVault.test.ts`), and the
revoke→401 + cross-user-403 + direction/mode-gating tests (`markdav.test.ts`).

---

## 10. Open questions (carried into ADR-0008)

1. Live mode default engine — **Yjs** (network-agnostic, our WebSocket) vs offering
   **CouchDB/LiveSync** for Obsidian-native users. (Leaning: Yjs core + optional CouchDB.)
2. Attachments (images/PDF) in shared folders — out of scope for v1 (text `.md` only);
   later via signed blob URLs.
3. Slug stability / renames — keep `id:` frontmatter as the join key so external renames
   don't fork the note (same role as `UID` in CalDAV).
4. Do we expose a read-only **public** share (link, no write) as a separate, even more
   restricted mode? (Likely yes, as a sub-option.)

---

_See also: [`caldav-bridge.md`](./caldav-bridge.md) (the architectural twin),_
_[`security/calendar-exposure.md`](./security/calendar-exposure.md) (egress control to_
_extend), [`adr/0004-offline-sync-queue.md`](./adr/0004-offline-sync-queue.md) (self-heal_
_patterns), [`adr/0008-external-markdown-sync.md`](./adr/0008-external-markdown-sync.md)._
