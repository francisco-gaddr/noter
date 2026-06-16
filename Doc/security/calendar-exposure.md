# Calendar & task data exposure — egress control surface

This is the authoritative map of **what task data can leave the server, by which path,
and how to shut each path down**. Use it to decide what to expose and to kill a channel
for security reasons. TL;DR: the real notes/tasks are end-to-end encrypted everywhere
and unreachable by the backend; the **only** plaintext that exists server-side is a
minimal, opt-in, lock-aware *projection* that the user explicitly enables per scope, and
it is reachable **only** through the two calendar channels below.

## The one principle

> The backend never holds the keys. Note/task `title`, `content`, `description`,
> `dueDate`, `completed`, `priority`, `locked` are stored as **ciphertext** and are
> undecryptable by the server, DB dumps, logs, admin tools, or the AI. The calendar
> channels do **not** decrypt anything — they serve a separate, client-pushed plaintext
> *projection* that the user opted to expose.

## Inventory: every path that can reach task data

| # | Path | Direction | What it can see | Auth | Plaintext? | Kill switch |
|---|------|-----------|-----------------|------|-----------|-------------|
| 1 | Normal app sync — `POST/PUT /api/notes`, `/api/tasks`, GraphQL, `/api/ai/sync`, WSS `note:*`/`task:*` | client ⇄ server | **Ciphertext only** — server stores/echoes encrypted blobs | JWT (account) | **No — E2E** | (n/a; this is the encrypted backbone) |
| 2 | **ICS feed** — `GET /api/calendar/:token.ics` | outward (public) | Projection of **enabled scopes**: title, due, completed (VEVENT) | **None** — 192-bit token in URL | **Yes** (opt-in) | `CALENDAR_ICS_ENABLED=0` |
| 3 | **CalDAV** — `/api/dav/**`, `/.well-known/caldav` | outward, two-way | Projection of **one enabled scope**: title, due, status, description, priority (VTODO); writes enqueue intents | **Basic-Auth**, per-feed hashed secret | **Yes** (opt-in) | `CALENDAR_CALDAV_ENABLED=0` |
| 4 | Projection push / DAV mint — `POST /api/calendar/subscription`, `PUT /feed`, `POST /dav` | client → server | Writes the plaintext projection into `CalendarFeed.items` | JWT (account) | Yes (the source of 2 & 3) | same flags (mint/push refused 403) |
| 5 | Mutation drain — `GET /api/calendar/mutations`, `POST /mutations/ack` | server → client | Transient write-back intents `{uid, op, data}` | JWT (account) | Yes (transient) | revoke the DAV credential (queue cleared) |
| 6 | AI / agents | internal | **Cannot** read locked notes; cannot decrypt without the user key | — | No | see [`ai-locked-notes.md`](./ai-locked-notes.md) |

Everything not in rows 2–5 is ciphertext. Rows 2–5 are the **entire** plaintext egress
surface, and all of it derives from `CalendarFeed`.

> **Planned (not yet implemented) — Markdown egress channel.** A future **External
> Markdown sync** ([`../external-markdown-sync.md`](../external-markdown-sync.md),
> [`../adr/0008-external-markdown-sync.md`](../adr/0008-external-markdown-sync.md)) will
> add a second, structurally-identical egress surface: an opt-in, lock-aware, client-pushed
> **note projection** (`MarkdownShare.files`) served over WebDAV at `/api/md`, with a
> per-share hashed credential, instant revoke, and a `MARKDOWN_SYNC_ENABLED=0` kill-switch
> reported at `health/deep → markdownExposure`. When it ships, add rows here for the
> `/api/md` (outward, two-way), projection-push, and mutation-drain paths — same model as
> rows 2–5, applied to note *files*. Until then there is **no** Markdown egress path.

## What is actually plaintext at rest, and where

Only the `calendarfeeds` MongoDB collection, and only for scopes the user enabled:

- `items[]` — `{ uid, title, start, allDay, completed, description?, priority? }`. Built
  by the client with `buildSafeCalendarProjection` (lock-aware: tasks in a locked list
  are **never** included), pushed opt-in. No note bodies, no other task fields.
- `pendingMutations[]` — transient CalDAV write-backs, drained + deleted by the client.
- `token` (ICS, 192-bit) and `davUser` + `davTokenHash` (CalDAV; the password itself is
  never stored — only its SHA-256).

Implication to be honest about: anyone with **database-level** access (server compromise,
a backup) can read the projection for *enabled scopes only* — that is the inherent cost
of handing plaintext to an external calendar service. It is bounded to the minimal fields
above, only for scopes the user turned on, never for locked lists, and is removable at any
time (see "Purge"). All other task/note content in the DB remains ciphertext.

## Controls — how to tighten or shut things down

### Per-user, per-scope (in-app, instant)
- **ICS:** Settings → Kalender (all) or Tasks 📅 menu (per list) → *Inaktivera*.
  API: `DELETE /api/calendar/subscription` `{ listId? }` — deletes the feed + token.
- **CalDAV:** Settings → CalDAV or Tasks sync menu → *Inaktivera*.
  API: `DELETE /api/calendar/dav` `{ listId? }` — clears `davUser`/`davTokenHash` and
  drops the mutation queue. Existing client connections 401 on the next request.
- **Rotate a leaked CalDAV password:** *Skapa nytt lösenord* (re-mint) invalidates the old.

### Operator-wide (env flags, hard kill — no code change)
Set on the backend service (e.g. compose env) and restart:

| Flag | Effect when `0`/`false`/`off` |
|------|-------------------------------|
| `CALENDAR_ICS_ENABLED=0` | `GET /:token.ics` → 404; creating/pushing ICS feeds → 403. Stored feeds untouched (instant re-enable). |
| `CALENDAR_CALDAV_ENABLED=0` | `/api/dav/**` and `/.well-known/caldav` → 404 (channel fully dark, no auth prompt); minting a DAV credential → 403. Stored credentials untouched. |

Both default to **on**. Verify the live state via `GET /api/health/deep` →
`calendarExposure: { ics, caldav }`. Disabling does **not** delete data — re-enabling is
instant; to also remove the plaintext, purge (below).

### Network layer
- Channels reach the backend only through nginx (`/api/` — which also carries `/api/dav/` — and `/.well-known/caldav`).
  Removing those `location` blocks from `apps/nginx/nginx.conf` blocks the channel at the
  edge regardless of the app flags — a second, independent shut-off.
- All traffic is HTTPS (TLS terminated at the edge). The ICS token and CalDAV password are
  only as safe as the link; treat a shared ICS URL as a bearer secret.

### Purge plaintext entirely
To remove all projected plaintext (e.g. after disabling a channel for good):
`db.calendarfeeds.deleteMany({})` — or per user `{ userId }`. The encrypted notes/tasks
are unaffected; users simply re-enable a feed later if wanted.

## Inward paths that must stay fully encrypted (invariants)

- Notes/tasks are written/read as ciphertext over rows 1 & 4; the server must never be
  given a key. The projection push (row 4) is the **only** place the client deliberately
  sends plaintext, and only the whitelisted projection fields.
- The projection must stay lock-aware: `buildSafeCalendarProjection` drops locked-list
  tasks before they ever reach `CalendarFeed`. Never bypass it.
- CalDAV writes must never attempt to decrypt/encrypt server-side — they only enqueue
  intents the client applies with the user key. Keep it that way.

## Related

- [`caldav-bridge.md`](../caldav-bridge.md) — CalDAV design + API.
- [`calendar-subscription.md`](../calendar-subscription.md) — ICS design.
- [`ai-locked-notes.md`](./ai-locked-notes.md) — AI never reads locked content.
- [`threat-model.md`](./threat-model.md), [`encryption-review-2026-06.md`](./encryption-review-2026-06.md).
