# Noter — CWE-mappning

_Senast uppdaterat: 2026-05-14 · Komplement till `threat-model.md`_

Den här filen kopplar Noters STRIDE-hot till MITRE CWE-id så vi kan leverera
audit-rapporter till CISO / kund-säkerhetsteam i ett standardformat.

| STRIDE-ID | Hot | Primär CWE | Sekundär | Status |
|-----------|-----|------------|----------|--------|
| T1 | Prompt-injection → MCP exfil | CWE-915 (improperly controlled modification of dynamically determined object attributes) | CWE-1390 | mitigerad: deny-by-default + intent-check |
| T2 | MCP-paket läser env-secrets | CWE-526 (cleartext storage of sensitive info in env vars) | CWE-829 | mitigerad: `createScopedEnv` + sandbox-exec/bubblewrap |
| T3 | Refresh-token replay | CWE-294 (authentication bypass by capture-replay) | CWE-613 | mitigerad: `useCount` + family-revoke + securityFlag |
| T4 | XSS i AI-chat-output | CWE-79 (XSS) | CWE-116 | mitigerad: nonce-CSP + text-only render |
| T5 | Path traversal mot modelPath | CWE-22 (path traversal) | — | mitigerad: realpath + allowlist-base |
| T6 | MITM mot backend | CWE-295 (improper certificate validation) | CWE-300 | mitigerad: cert-pinning via `NOTER_PINNED_CERT_FINGERPRINTS` |
| T7 | GraphQL DoS | CWE-770 (resource exhaustion) | CWE-1284 | mitigerad: depth+complexity+trusted-docs |
| T8 | Auth-burst DoS | CWE-307 (improper restriction of excessive auth) | — | mitigerad: sliding rate-limit |
| T9 | Plaintext fallback | CWE-321 (use of hard-coded crypto key) | CWE-256 | mitigerad: DEFAULT_KEY borttagen |
| T10 | DB-corruption via proto-pollution | CWE-915 / CWE-1321 | — | mitigerad: mongoSanitize + blockSuspiciousRequestPatterns |
| T11 | Repudiation av tool-call | CWE-778 (insufficient logging) | — | mitigerad: AEAD audit + intent log |
| T12 | Insider DB-read | CWE-311 (missing encryption at rest) | CWE-359 | mitigerad: E2E-enc + optional KMS wrap |
| T13 | Förlorad enhet → token-stöld | CWE-922 (insecure storage of sensitive info) | — | mitigerad: SecureStore + biometric gate |
| T14 | GGUF-fil-stöld | n/a (public assets) | — | accepterad risk |
| T15 | Renderer-XSS → main escape | CWE-79 + CWE-829 | — | mitigerad: contextIsolation + sandbox + IPC allowlist |
| T16 | LFI/SSRF via http-bridge | CWE-918 (SSRF) | CWE-22 | mitigerad: host-allowlist + manual redirect + size cap |
| T17 | CSRF mot cookies | CWE-352 (CSRF) | — | mitigerad: Origin/Referer + sameSite=strict refresh |
| T18 | Loggar läcker secrets | CWE-532 (insertion of sensitive info into log) | — | mitigerad: `sanitizeLogInfo` redaction |
| T19 | IDOR: läs/skriv/radera annan users note/task via gissat id | CWE-639 (authorization bypass through user-controlled key) | CWE-862 (missing authorization) | mitigerad: alla `/:id`-handlers scopar på `userId` (se nedan) |

## T19 — IDOR i `/:id`-handlers (åtgärdad 2026-06-13)

Hard-review av REST-rutterna hittade fyra handlers som slog upp objektet med
`findById(req.params.id)` **utan** `userId`-scope. En autentiserad användare kunde
därmed nå en annan användares data genom att gissa/iterera ObjectId:t:

| Rutt | Fil | Påverkan före fix |
|------|-----|-------------------|
| `GET /api/notes/:id` | `routes/notes.ts` | Läste annan users note-innehåll **och** `+password` bcrypt-hash |
| `PUT /api/notes/:id` | `routes/notes.ts` | Skrev över annan users note |
| `PUT /api/tasks/:id` | `routes/tasks.ts` | Skrev över annan users task |
| `DELETE /api/tasks/:id` | `routes/tasks.ts` | Raderade annan users task |

`DELETE /api/notes/:id` och `verify-lock` var redan korrekt scopade
(`findOne({ _id, userId })`) — inkonsekvensen gjorde buggen lätt att missa.

**Fix:** alla fyra slår nu upp via `findOne({ _id: req.params.id, userId })`, så en
icke-ägare får `404` (medvetet — avslöjar inte att id:t existerar). Datat ligger
fortfarande E2E-krypterat, men auktorisationslagret läckte metadata, kunde radera
poster och exponerade lösenords-hashen — därav allvarlighetsgrad hög.

**Regression:** `__tests__/routes/ownership-isolation.test.ts` kör två användare
(Alice/Bob) genom hela CRUD-round-trippen och bevisar att Bob får `404` på läs/
skriv/radera av Alices note och task, samt att posten är orörd på disk efteråt.
Ingår i den blockerande `validate-critical.mjs`-matrisen.

## Format för audit-export

`Doc/security/cwe-mapping.md` läses av `Doc/security/exportReport.mjs`
(scaffold — se nedan) som producerar en CSV med kolumnerna
`CWE-ID, Threat, Severity, Status, MitigationCommit` redo att lämnas till
extern säkerhetsgranskning.

```sh
node Doc/security/exportReport.mjs > audit-2026-Q2.csv
```

## CWE-id som behöver dokumenteras nästa

Saker som inte är i tabellen ännu men borde:

- CWE-330 (insufficient randomness) — verifiera att alla random-bytes
  använder `crypto.randomBytes` / `getRandomValues`, inte `Math.random`.
- CWE-209 (information exposure through error messages) — vi har en
  `errorHandler` men felmeddelanden behöver konsekvensgranskas.
- CWE-1004 (sensitive cookie without HttpOnly) — alla cookies har httpOnly,
  bekräfta i regression-test.
- CWE-345 (insufficient verification of data authenticity) — använd HMAC i
  webhook-leveranser (gjort), men kontrollera även intern outbox-dispatch.
