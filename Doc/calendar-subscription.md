# Calendar (ICS) subscription

Status: **active** (app v1.4.0). Lets a user subscribe to their dated tasks from an
external calendar (Google Calendar, Apple Calendar on Mac) via a tokenized URL, kept
live as tasks change.

## The E2E constraint (why the client pushes a projection)

Task `title` and `dueDate` are **end-to-end encrypted at rest** — the backend stores
ciphertext and cannot read them. A calendar app fetches raw ICS text, which must be
plaintext at fetch time. So the server can't build the ICS from the encrypted tasks.

Design: the **client** (which holds the decrypted tasks) builds a minimal plaintext
projection — `{ uid, title, start, allDay, completed }` per dated task — and pushes it
to the backend feed. The public ICS endpoint serves that projection. This is opt-in:
the user is choosing to expose those fields to an external calendar (where they'd be
plaintext anyway). Nothing else about the task is stored or served.

## Shape

```text
Client (has plaintext tasks)
  buildCalendarProjection(tasks)  →  POST /api/calendar/subscription { items }   (mint token + seed)
                                     PUT  /api/calendar/feed         { items }   (live updates, debounced on task change)
External calendar (Google/Apple)
  GET  /api/calendar/<token>.ics   →  generateIcs(items)   (public, token-scoped; polled by the calendar app)
```

- **`@repo/shared` `src/calendar.ts`** (pure, tested): `buildCalendarProjection(tasks)`
  (only dated, non-deleted tasks; all-day detection normalised to UTC-midnight of the
  local date to avoid timezone off-by-one) and `generateIcs(items, { now })`
  (hand-rolled RFC 5545: CRLF, text escaping, `VALUE=DATE` for all-day, `STATUS`,
  `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` hints).
- **Backend** `models/CalendarFeed.ts` (one doc per user: `token` + `items`) and
  `routes/calendar.ts`. `GET /:token.ics` is public (token in the path — calendar apps
  can't send a bearer header); `POST/PUT/DELETE` are auth-gated per-route. Mounted at
  `/api/calendar` with no mount-level auth so the public GET is reachable.
- **Clients**: `services/calendarSubscription.ts` (mobile) / `lib/calendarSubscription.ts`
  (web+electron) — create/copy URL, push projection, revoke; URL+flag cached locally.
  Settings has "Skapa/Kopiera kalenderlänk" + "Inaktivera". A debounced effect pushes
  the projection whenever tasks change (no-op unless subscribed).

## "Live" — what it actually means

ICS subscription is **poll-based on the calendar app's schedule**, not push. Google
Calendar refreshes subscribed ICS URLs roughly every few hours up to ~24h; Apple
Calendar has a user-set refresh interval. The app keeps the server-side feed current
(every task change), so the external calendar gets fresh data on its next poll. The
feed advertises `REFRESH-INTERVAL:PT1H` / `X-PUBLISHED-TTL:PT1H` as a hint, but the
calendar service ultimately decides the cadence.

## Token / revocation

One 192-bit random token per user (the only credential in the URL). "Inaktivera"
deletes the feed+token (the old URL stops working); creating again mints a fresh token.

## Configuration

The subscription URL is derived from the request (`req.protocol`://`host`), or from
`PUBLIC_BASE_URL` if set — set that env var behind a proxy if the request host isn't
the public one.
