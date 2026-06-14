# CalDAV Bridge (two-way tasks ↔ external calendar/reminder apps)

Exposes the user's tasks as a **read/write CalDAV `VTODO` calendar** that standard
clients — **Tasks.org** (Android) and **Reminders** (macOS/iOS) — can subscribe to.
It complements the read-only [ICS feed](calendar-subscription.md): ICS is a one-way
`VEVENT` stream for calendar apps; CalDAV is two-way `VTODO` for to-do/reminder apps.

The user chooses to expose **all dated tasks** OR **a specific task-list**, can hand
out a credential per scope, and can **revoke** any of them instantly.

## Why a bridge (the E2E constraint)

Task `title`, `description`, `dueDate`, `completed`, and `priority` are all
**end-to-end encrypted at rest** — the server stores ciphertext and has no key. So the
backend can neither read a task to render it nor write one to update it. The bridge
works around this exactly like the ICS feed does, plus a write path:

- **Read** — the client (which has the plaintext) pushes a minimal, **lock-aware**
  projection (`buildSafeCalendarProjection`) into `CalendarFeed.items`. The CalDAV
  server renders those items as `VTODO`. Locked-list tasks are never in the projection.
- **Write** — a CalDAV `PUT`/`DELETE` can't touch ciphertext, so it is recorded as a
  **non-sensitive mutation intent** (`{ uid, op, data }`) in `CalendarFeed.pendingMutations`.
  The client drains the queue (`GET /api/calendar/mutations`), applies each change to
  the real encrypted task **with the user's key**, acks it, and re-pushes the projection.
  This is eventually-consistent (bounded by the client's drain cadence) but keeps E2E
  fully intact — the server never sees a key.

```
Tasks.org / Reminders ──CalDAV──▶  /dav (backend)
   │  GET/PROPFIND/REPORT  ◀── renders VTODO from CalendarFeed.items (plaintext projection)
   │  PUT/DELETE           ──▶ enqueues { uid, op, data } in pendingMutations
                                         │
Noter app  ──GET /api/calendar/mutations─┘  apply with user's key → ack → re-push projection
```

## Security model

- **Auth is HTTP Basic with a per-feed credential**, never the account password.
  `davUser` is a non-secret lookup username (`noter-<16 hex>`); the password is a
  32-char (~192-bit) secret shown **once** and stored only as `SHA-256` (`davTokenHash`).
  Verification is constant-time; failed auth is throttled per IP.
- **Least privilege / scope isolation** — one credential maps to exactly one
  `CalendarFeed` (a scope: all-tasks or one list). A credential can only read/write its
  own scope; the principal tree is checked against the authenticated feed (cross-tree →
  403). A per-list credential never sees other lists' tasks.
- **Instant revoke** — `DELETE /api/calendar/dav` clears `davUser`/`davTokenHash` and
  drops the mutation queue; the next request 401s. The ICS feed/token is untouched.
- **Lock-aware** — locked task-lists are excluded from the projection, so their titles
  never reach CalDAV.
- **Transport** — always behind HTTPS (TLS terminated at the edge / nginx). nginx
  passes the WebDAV verbs through to the backend; the `/dav` router runs before the
  browser middleware and does its own Basic-Auth + raw body parsing.

## Data mapping (Noter task ↔ RFC 5545 VTODO)

| Noter field        | VTODO property                                   |
| ------------------ | ------------------------------------------------ |
| task id / clientId | `UID`                                            |
| title              | `SUMMARY`                                         |
| description        | `DESCRIPTION`                                     |
| dueDate            | `DUE` ( `;VALUE=DATE` when all-day )              |
| completed          | `STATUS:COMPLETED` + `PERCENT-COMPLETE:100` + `COMPLETED:` |
| not completed      | `STATUS:NEEDS-ACTION`                             |
| priority           | `PRIORITY` (high→1, medium→5, low→9)              |

`packages/shared/src/caldav.ts` is the single source for VTODO generate/parse
(dependency-free, unit-tested in `caldav.test.ts`).

## HTTP API

### CalDAV protocol (native clients) — mounted at `/dav`, Basic Auth

| Method      | Path                                   | Purpose |
| ----------- | -------------------------------------- | ------- |
| `OPTIONS`   | `/dav/…`                               | Advertise `DAV: 1, 2, 3, calendar-access` + `Allow` |
| `PROPFIND`  | `/dav/<user>/`                         | Principal: `current-user-principal`, `calendar-home-set` |
| `PROPFIND`  | `/dav/<user>/cal/`                     | Calendar-home; Depth:1 lists the one collection |
| `PROPFIND`  | `/dav/<user>/cal/tasks/`               | Collection props; Depth:1 lists `VTODO` resources + etags |
| `REPORT`    | `/dav/<user>/cal/tasks/`               | `calendar-query` / `calendar-multiget` / `sync-collection` → `VTODO` data |
| `GET`       | `/dav/<user>/cal/tasks/<uid>.ics`      | One `VTODO` (+ `ETag`) |
| `PUT`       | `/dav/<user>/cal/tasks/<uid>.ics`      | Enqueue an `upsert` (complete/edit/create) |
| `DELETE`    | `/dav/<user>/cal/tasks/<uid>.ics`      | Enqueue a `delete` |
| `PROPPATCH` | `/dav/<user>/cal/tasks/`               | 207 (collection props are read-only) |

`/.well-known/caldav` → `301 /dav/` for client auto-discovery.

### Credential + mutation management (the Noter app) — `/api/calendar`, Bearer JWT

| Method   | Path                          | Body / notes |
| -------- | ----------------------------- | ------------ |
| `POST`   | `/api/calendar/dav`           | `{ listId?, displayName?, items? }` → `{ username, password (once), serverUrl, collectionUrl }` |
| `GET`    | `/api/calendar/dav`           | List DAV-enabled scopes (never the password) |
| `DELETE` | `/api/calendar/dav`           | `{ listId? }` → revoke that scope's credential |
| `GET`    | `/api/calendar/mutations`     | Pending write-backs for the client to apply |
| `POST`   | `/api/calendar/mutations/ack` | `{ ids: [...] }` → remove applied mutations |

## Database schema (`CalendarFeed`)

One document per `(userId, listId)` — `listId: null` = the all-tasks scope.

| Field              | Type                | Notes |
| ------------------ | ------------------- | ----- |
| `userId`           | string (indexed)    | owner |
| `listId`           | string \| null      | scope; compound-unique with `userId` |
| `token`            | string (unique)     | public ICS token (unchanged) |
| `items`            | `[{ uid, title, start, allDay, completed, description?, priority? }]` | plaintext projection |
| `davUser`          | string \| null (sparse-unique) | CalDAV Basic-Auth username |
| `davTokenHash`     | string \| null      | `SHA-256` of the CalDAV password |
| `davDisplayName`   | string \| null      | collection display name (the list's real name is encrypted) |
| `davCreatedAt` / `davLastSeenAt` | Date \| null | lifecycle |
| `pendingMutations` | `[{ id, uid, op: 'upsert'\|'delete', listId, data?, at }]` | write-back queue (capped at 500) |

`reconcileCalendarFeedIndexes()` (run after the Mongo connect at boot) ensures the
compound `(userId, listId)` unique index and the sparse-unique `davUser` index, since
production runs with `autoIndex` off.

## Shutting it down (operator kill-switch)

Set `CALENDAR_CALDAV_ENABLED=0` on the backend to make `/dav` + `/.well-known/caldav`
return 404 and refuse new credential mints (403) — the channel goes fully dark without
touching stored data (instant re-enable). `CALENDAR_ICS_ENABLED=0` does the same for the
ICS feed. Confirm live state at `GET /api/health/deep` → `calendarExposure`. The full
egress map + per-scope/per-user/network controls live in
[`security/calendar-exposure.md`](./security/calendar-exposure.md).

## Client setup

**Apple Reminders (macOS):** System Settings → Internet Accounts → Add Account → Add
CalDAV Account → Manual → Server `https://<host>/dav/`, the username + password from
the app. **Tasks.org (Android):** add a CalDAV account with the same three values.

In Noter: **Settings → CalDAV** for the all-tasks scope, or the 📅/sync menu on the
**Tasks** screen (with a list selected) for that one list. The password is shown once;
"create new password" rotates it; "inaktivera" revokes instantly.

### Known limitation

Creating a *brand-new* task from the widget works (it's enqueued as an `upsert` with the
widget's UID as `clientId` on mobile so later edits match). On web, widget-created tasks
are best-effort and may not de-duplicate against later widget edits until the next full
projection push. Completing/editing/deleting **existing** tasks is fully reliable.
