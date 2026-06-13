# Noter Backend API Reference

This documents the actual HTTP surface of the backend (`noter-app/apps/backend`),
generated from the route definitions in `src/index.ts` and `src/routes/*`. It is
meant to be **verifiable against the code** — every endpoint, auth requirement,
and rate limit below corresponds to a concrete mount or middleware in the source.

- Base URL (prod): `https://<host>/api`
- Transport: HTTPS only (HSTS enforced by nginx; WSS for realtime, see Sockets).
- Content type: `application/json` for all request/response bodies.

---

## Authentication

Two independent schemes. Both resolve to a user identity; the route decides which it accepts.

| Scheme | Header | Used by |
| ------ | ------ | ------- |
| **JWT (Bearer)** | `Authorization: Bearer <jwt>` | First-party clients (web, mobile, electron). Issued by `/api/auth/login` and `/api/auth/register`. |
| **API key** | `Authorization: ApiKey nk_<kid>_<secret>` | External / programmatic integrations. Minted via `/api/keys/api-keys`. |

JWTs are signed with a rotating key set (`jwtKeySet`); old keys remain valid for
verification until rotated out. API-key tokens have the shape
`nk_<8-char-kid>_<32-char-base64url-secret>`; only a SHA-256 hash of the secret
is stored server-side — the plaintext token is shown **once** at mint time and is
not retrievable again.

### Encrypted-payload write enforcement

Note and task write routes reject plaintext. The `isEncryptedPayload` guard
(`src/utils/encryption.ts`) accepts a field only if it carries a recognised
ciphertext envelope:

- `U2FsdGVkX1…` — legacy CryptoJS AES-CBC (v1)
- `v3:…` — AES-256-GCM + Argon2id (v3)

A write whose encrypted fields are plaintext returns **400**. This is what keeps
data-at-rest encrypted on the server disk and in MongoDB.

---

## Rate limits

Limits are enforced by `createRateLimit` (Redis-backed with in-memory fallback;
`src/middleware/rateLimit.ts`). Every limited response carries
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (seconds).
Exceeding a limit returns **429**.

| Limiter | Scope | Points | Window | Block |
| ------- | ----- | -----: | ------ | ----- |
| `global` | all `/api` traffic | 100 | 15 min | — |
| `auth` | `/api/auth/*` | 20 | 15 min | 15 min |
| `apiSensitive` | `/api/keys`, `/api/mcp`, `/api/graphql` | 40 | 10 min | — |
| `verify-lock` | `POST /api/notes/:id/verify-lock` | 25 | 10 min | — |

Body-size caps: `/api/auth` 10 KB, `/api/ai/sync` 2 MB (others use the app default).

---

## Endpoints

### Auth — `/api/auth` (no auth; `auth` limiter)

| Method | Path | Body | Returns |
| ------ | ---- | ---- | ------- |
| POST | `/register` | `{ username, password }` | `{ token, user }` |
| POST | `/login` | `{ username, password }` | `{ token, user }` |

### Key bundle — `/api/keys/bundle` (JWT; `apiSensitive` limiter)

Stores the per-user E2E key material. The server only ever holds the **opaque**
wrapped key — it cannot derive `dataKey` without the user's password.

| Method | Path | Body / Returns |
| ------ | ---- | -------------- |
| GET | `/bundle` | `{ wrappedDataKey, kdfSalt, kdf, keyVersion }`; **404** `NO_KEY_BUNDLE` before enrolment |
| PUT | `/bundle` | Body `{ wrappedDataKey: "v3w:…", kdfSalt, kdf: "argon2id"\|"pbkdf2", keyVersion }`. Rejects a `wrappedDataKey` without the `v3w:` envelope or an unknown `kdf` (**400**). |

### API keys — `/api/keys/api-keys` (JWT; `apiSensitive` limiter)

| Method | Path | Body / Returns |
| ------ | ---- | -------------- |
| POST | `/api-keys` | Body `{ scopes?: string[] }` (max 8). Returns **201** `{ token, kid, scopes }` — `token` shown once. |
| GET | `/api-keys` | `{ keys: [{ kid, scopes, createdAt, lastSeenAt, revokedAt }] }` — never the secret/hash. |
| DELETE | `/api-keys/:kid` | **200** on revoke; **404** if `kid` unknown. |

Known scopes: `notes:read`, `notes:write`, `tasks:read`, `tasks:write`.

### Notes — `/api/notes` (JWT; conditional-GET + idempotency + audit log)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/` | List the user's notes. Supports ETag / `If-None-Match` (304). |
| GET | `/:id` | Single note. |
| POST | `/:id/verify-lock` | Verify a per-note lock password. `verify-lock` limiter (25 / 10 min). |
| POST | `/` | Create. Encrypted-payload enforced. |
| PUT | `/reorder` | Bulk reorder. |
| PUT | `/:id` | Update. Encrypted-payload enforced. |
| DELETE | `/:id` | Delete. |

### Tasks — `/api/tasks` (JWT; conditional-GET + idempotency + audit log)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/` | List the user's tasks. |
| POST | `/` | Create. Encrypted-payload enforced. |
| PUT | `/assign-to-list` | Move task(s) to a list. |
| PUT | `/reorder` | Bulk reorder. |
| PUT | `/:id` | Update. |
| DELETE | `/:id` | Delete. |

### AI sync — `/api/ai/sync` (JWT; 2 MB body cap)

End-to-end-encrypted AI thread sync. The server stores only ciphertext.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/pull` | Pull encrypted conversations/messages changed since a cursor. |
| POST | `/push` | Push local encrypted changes. Validated by `pushSchema`. |

### MCP — `/api/mcp` (JWT; `apiSensitive` limiter)

| Method | Path | Notes |
| ------ | ---- | ----- |
| POST | `/tools` | List available MCP tools for the user's configured integrations. |
| POST | `/call` | Invoke an MCP tool. |
| GET | `/health` | MCP runtime health. |
| GET | `/dashboard` | Per-integration usage/status dashboard. |
| GET | `/dashboard/system` | System-level MCP metrics. |

### AI models — `/api/ai/models` (no JWT middleware at mount)

Local-model lifecycle for on-device inference (search → download → convert → run).

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/search` | Search the model registry. |
| GET | `/health` | Model service health. |
| GET | `/files` | List downloaded model files. |
| GET | `/compiled` | List compiled/converted models. |
| GET | `/compiled-file` | Fetch a compiled artifact. |
| POST | `/convert` | Start a conversion job. |
| GET | `/convert` | Poll conversion status. |

### Health & misc

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| GET | `/api/health/deep` | none | Deep health check (DB, Redis, dependencies). |
| POST | `/api/csp-report` | none | CSP violation report sink. |
| * | `/api/graphql` | JWT | GraphQL endpoint (`apiSensitive` limiter). |
| * | `/api/*` (unmatched) | — | JSON 404. |

---

## Sockets (realtime)

Realtime updates use socket.io over **WSS**. The connection is authenticated in
`io.use(...)` with the same JWT as REST (`Authorization` / `auth.token`); an
unauthenticated socket is rejected at the handshake. Payloads mirror the REST
encryption contract — the server relays ciphertext, never plaintext.

---

## Error shape

Errors flow through `errorMiddleware` and return a consistent JSON body:

```json
{ "error": "human readable message", "code": "MACHINE_CODE", "details": { } }
```

Common codes: `NO_KEY_BUNDLE` (404), `API_KEY_MISSING_SCOPE` (403),
validation failures (400, from Joi `validate`), `429` rate-limit (no body code,
see `X-RateLimit-*` headers).

---

*Source of truth: `noter-app/apps/backend/src/index.ts` and `src/routes/*`.*
*Regenerate this table from those files when routes change — do not hand-edit drift in.*
