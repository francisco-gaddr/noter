# ADR-0008: External Markdown sync for selected notes/folders

**Status:** Proposed
**Date:** 2026-06-16
**Author(s):** Noter team

## Context

The user wants to expose **specific notes and project-folders** as a **Markdown vault**
reachable from **Obsidian, macOS apps, Android apps, and widgets**, with **real-time
two-way sync**, **per-item opt-in**, and **instant revoke** from in-app settings — while
the rest of the account stays **fully end-to-end encrypted**.

Constraints:
- Noter is **E2E** (v3 AES-GCM + Argon2id). The server holds **ciphertext only, no key**,
  so it cannot read a note to serve it nor write one from an inbound edit. A plain
  "serve the files from the server" design would force server-side plaintext/keys for the
  whole account — unacceptable.
- We already operate the **CalDAV bridge** ([`../caldav-bridge.md`](../caldav-bridge.md)):
  client-pushed plaintext **projection** of an opted-in scope + per-share hashed
  credential + inbound **mutation queue** drained by the client + socket nudge +
  operator kill-switch + edge routing under `/api/*`. It is proven, secure, and
  E2E-preserving.
- 2026 landscape (researched): real-time collaborative Markdown is now **CRDT/local-first**
  (Yjs dominant; Automerge/Loro; Obsidian **Relay** is keystroke-level CRDT). Broad file
  compatibility (non-Obsidian, widgets) is still **WebDAV**. Obsidian **LiveSync** (CouchDB,
  E2EE) is the proven self-hosted near-real-time option *within* Obsidian.

## Decision

Build it as the **Markdown/files twin of the CalDAV bridge**, layered:

1. **Phase 1 (baseline):** a **WebDAV Markdown vault** per share — client-pushed plaintext
   projection of opted-in folders/notes, served as `.md` files over WebDAV at `/api/md`,
   with a per-share hashed credential, an inbound file-mutation queue drained + re-encrypted
   by the client, lock-aware projection, instant revoke, and an operator kill-switch.
   Reaches Obsidian (Remotely Save), macOS Finder, Android, and widgets.
2. **Phase 2 (real-time upgrade, opt-in):** a **CRDT "Live" mode** (Yjs rooms scoped per
   share, bridged to the encrypted note store) for keystroke-level real-time; optionally a
   per-share **CouchDB** database for users who prefer **Obsidian LiveSync**.

Only the explicitly-shared subset is ever projected to plaintext (by the client, which
holds the key); everything else — and all **locked** notes — stays E2E and is never
exposed.

## Considered alternatives

- **WebDAV Markdown vault (chosen, Phase 1)** — *pros:* broadest client reach incl.
  non-Obsidian + widgets; maps 1:1 onto our CalDAV stack (per-share creds, projection,
  mutation queue, kill-switch, edge routing) → low risk, fast, reuses self-heal patterns;
  E2E-preserving by construction; trivial revoke. *cons:* near-real-time (poll + nudge),
  not keystroke-live; last-writer-wins needs conflict-copy handling.
- **CRDT live (Yjs/Relay-style) (chosen, Phase 2)** — *pros:* true keystroke real-time,
  conflict-free multi-writer, offline merge, the 2026 state of the art. *cons:* not a
  plain-files protocol (needs a CRDT room + bridge + editor binding); generic file apps
  can't speak it; larger build. → additive upgrade, not the baseline.
- **CouchDB + Obsidian LiveSync (Phase 2 alternative)** — *pros:* mature near-real-time,
  CouchDB handles replication/conflict/self-heal; per-share DB is a clean scope/revoke
  boundary. *cons:* **Obsidian-only**; adds a CouchDB service; our Mongo notes must be
  bridged to LiveSync's chunked doc schema. → offered per-user, not default.
- **Git (Obsidian Git)** — *cons:* not real-time, manual merge conflicts, leaks history.
  ❌
- **S3/object storage (Remotely Save S3)** — *cons:* interval-only, extra infra, no native
  real-time. ❌
- **Status quo (no external MD)** — notes stay app-only. *cons:* doesn't meet the goal.

## Consequences

**Better:** users get Obsidian/Finder/Android/widget access to chosen notes, two-way, with
strong selective E2E and instant revoke; ~80% infra reuse from CalDAV keeps Phase 1 small
and low-risk; a clear path to best-in-class real-time (CRDT) without rebuilding the
security model.

**Worse / cost:** a second egress channel to govern (extend
[`../security/calendar-exposure.md`](../security/calendar-exposure.md), add
`markdownExposure` to `health/deep`); a new server-side plaintext store for shared notes
(scoped, opt-in, purged on un-share); Phase 2 CRDT is a genuinely larger initiative.

**Follow-up decisions:** Live engine (Yjs vs CouchDB) per Open questions; attachment
handling; public read-only sub-mode.

## Implementation notes

- Shared: `packages/shared/src/markdownVault.ts` (note↔MD serialize/parse) — twin of
  `caldav.ts`, dependency-free + unit-tested.
- Backend: `MarkdownShare` model (twin of `CalendarFeed`); `apps/backend/src/markdav/server.ts`
  at `/api/md` (twin of `caldav/server.ts`); REST `/api/md/shares`, `/dav`, `/mutations`
  (Bearer JWT, userId-scoped — IDOR rule). `MARKDOWN_SYNC_ENABLED` kill-switch.
- Clients: `services/markdownShare.ts` (mobile + web) — projection push + mutation drain +
  share/credential UI + per-item toggle.
- Phase 2: Yjs room server module + editor bindings; optional CouchDB bridge.
- Gates per phase: `validate-critical.mjs` green; route-scoping (IDOR) check;
  no-plaintext-egress test for non-shared notes; revoke→401 integration test;
  lock-never-projected test.
- Full plan: [`../external-markdown-sync.md`](../external-markdown-sync.md).

## Open questions

1. Live-mode default engine: **Yjs** (network-agnostic, our WebSocket) vs **CouchDB/LiveSync**
   for Obsidian-native users. (Leaning Yjs core + optional CouchDB.)
2. Attachments (images/PDF) in shared folders — v1 text-only; later signed blob URLs.
3. Public read-only share sub-mode (link, no write)?
4. Rename/slug stability handled by `id:` frontmatter join key (like `UID`).
