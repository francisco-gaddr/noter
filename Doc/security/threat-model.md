# Noter — Threat model (STRIDE)

_Senast uppdaterat: 2026-05-14 · Målgrupp: säkerhetsansvariga, reviewers, ops_

Den här filen är ett formellt STRIDE-pass över Noter med fokus på **AI tool-execution-vägen** och **MCP-runtime**, eftersom det är där angreppsytan är störst. Övriga komponenter (auth, lagring, transport) noteras i översikten men har historiska egna granskningar.

STRIDE: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, **E**levation of privilege.

## Komponenter i scope

| Komponent | Förtroende | Datatyp |
|-----------|------------|---------|
| Mobil-/Web-/Electron-klient | Användarkontrollerad | klartext + krypterad |
| Backend Express (REST/GraphQL/Socket) | Vår tillit | krypterad ciphertext |
| MongoDB | Vår tillit | krypterad ciphertext + metadata |
| Redis (cache + rate-limiter) | Vår tillit | server-side data |
| MCP-subprocesser (npx-paket m.fl.) | **Tredjepart, untrusted** | env-konfiguration, tool-args |
| AI-providers (OpenRouter, Gemini, lokal MLC/llama.cpp) | Externa | prompts + tool-resultat |
| HuggingFace Hub | Extern | nedladdade GGUF/MLC-modeller |

## Trust boundaries

```
Användare ─┬─► Mobil-/Web-/Electron-klient ─► Backend ─► MongoDB
           │                                  │     │
           │                                  │     └─► Redis (cache, rate-limit)
           │                                  │
           │                                  └─► MCP runtime ─► spawn(npx ...)
           │                                                       └─► externa SaaS-tjänster
           │
           └─► AI-provider (lokal eller remote) ──► tool-calls tillbaka till klient
```

Tre trust boundaries:
1. **Användare ↔ Klient** — Antaganden om att klienten är ren bryts av kompromettering (skadlig extension, root, jailbreak).
2. **Klient ↔ Backend** — TLS + cookies/bearer; backend ska aldrig anta att klienten validerat data.
3. **Backend ↔ MCP-subprocess** — Hela MCP-paketen är untrusted kod. Vi får inte läcka secrets till dem och måste begränsa deras filsystemsåtkomst.

## STRIDE-tabell

| ID | Hot | STRIDE | Sannolikhet | Påverkan | Mitigation |
|----|-----|--------|-------------|----------|------------|
| T1 | AI-provider injicerar prompt som ber MCP-tool exfiltrera notes till extern tjänst | S+I | Hög | Hög | `isExplicitServiceIntent` kräver explicit user-keyword + verb + negation-check; MCP allowlist per tjänst; intent-spår i audit |
| T2 | Tredjeparts MCP-paket läser `JWT_SECRET` / `MONGO_URI` från process.env | I+E | Medium | Kritisk | `createScopedEnv` strippar allt utom whitelisted vars; framtida: bubblewrap/sandbox-exec |
| T3 | Refresh-token replay (stulet kakvärde) | E | Medium | Hög | RefreshToken `useCount`-counter, family-revoke vid replay, fingerprint UA/IP-match, `sameSite='strict'` |
| T4 | XSS i AI-chat-output (assistent returnerar `<script>`) | T+E | Medium | Hög | Renderer-CSP via nonce (no `unsafe-inline` script); text renderas inte som HTML; modal tool-result-viewer escapes alltid |
| T5 | Path traversal mot `/app/api/ai/route.ts` modelPath | I+E | Låg | Hög | `resolveAllowedModelPath` med `fs.realpath` + base-dir-check |
| T6 | MITM mot backend-API (fake CA i Electron-Chromium) | T+I | Låg | Hög | `NOTER_PINNED_CERT_FINGERPRINTS` + `setCertificateVerifyProc` |
| T7 | GraphQL DoS via djupa/komplexa queries | D | Medium | Medium | depth-limit, fields-limit, complexity-limit, trusted documents i prod |
| T8 | DoS via auth-burst | D | Hög | Medium | Sliding-window limiter (`rate-limiter-flexible`) + fixed-window legacy; egen Redis-instans |
| T9 | Plaintext fallback om CryptoJS-nyckel saknas | I | Låg | Kritisk | `DEFAULT_KEY` borttagen; encrypt/decrypt kastar utan nyckel |
| T10 | DB-corruption via prototype pollution-payload | T | Låg | Hög | `blockSuspiciousRequestPatterns` + `mongoSanitize` + Joi/zod-validering |
| T11 | Repudiation: användare nekar tool-call de utfört | R | Låg | Medium | MCP audit-event krypteras at-rest (AEAD), `intentText` loggas, dashboard read-only för user |
| T12 | Insider med DB-access läser krypterade fält | I | Medium | Medium | E2E-encryption — data lagras som ciphertext; servern har inte nyckeln (förutsatt att GraphQL-vägen aldrig dekrypterar; verifierat i schema.ts) |
| T13 | Token-stöld via fil-läs på enhet (förlorad device) | I+S | Medium | Hög | Electron `safeStorage` (OS-binding); mobile SecureStore + biometric gate default i prod |
| T14 | Stulen MLC GGUF-fil från Electron userData | I | Låg | Låg | E2E-modeller är publika (HuggingFace); inga personliga data i modellfilen |
| T15 | Local renderer XSS escaperar till main-processen | E | Låg | Kritisk | `contextIsolation`, `sandbox`, `nodeIntegration: false`, IPC-allowlist via `assertTrustedIpcSender` |
| T16 | LFI/SSRF via Electron `http:request` bridge | I+E | Medium | Hög | Allowlist-hosts (HF, OpenRouter, Gemini, backend), `credentials: 'omit'`, redirect: manual, response-size cap |
| T17 | CSRF mot cookie-skyddade endpoints | E | Medium | Hög | `csrfOriginMiddleware` (Origin/Referer-check); Bearer-token exempt |
| T18 | Loggar läcker secrets (token, lösenord) | I | Medium | Medium | `sanitizeLogInfo` redaction; daily-rotate caps disk usage |

## Säkerhetsantaganden som behöver bevisas

- **A1.** `/api/graphql` är skyddad av `authMiddleware` *före* `trustedDocumentsMiddleware`. Bekräftat i `index.ts:308`.
- **A2.** MCP `spawn(...)` får aldrig en miljö som innehåller `JWT_SECRET`. Bekräftat i `services/mcp/runtime.ts` (`createScopedEnv`).
- **A3.** AI-route `POST /app/api/ai` kräver auth *före* `loadModel`. Bekräftat i `apps/web/app/api/ai/route.ts:16`.
- **A4.** RefreshToken-replay i `/auth/refresh` revokerar familjen *innan* vi returnerar nya tokens. Bekräftat i `routes/auth.ts:215–235`.

## Kvarstående risker (acceptables eller pågående)

1. **Argon2id parameter-vandring** — Vi kör nu `memoryCost: 64 MiB, timeCost: 3`. Bör justeras när hårdvara skalar; bumpa över tid med backwards-compatibility via `keyWrapVersion`.
2. **Multi-device collab race** — Yjs-scaffold finns men ingen produktion-bind ännu. CRDT-merge-säkerhet ska valideras innan multi-device skrivs.
3. **MCP subprocess sandbox** — Vi strippar env men kör fortfarande inom backend-processen. På Linux ska vi flytta till bubblewrap/seccomp.
4. **Audit-export** — Säkerhetsdashboard räcker för incidentutredning idag, men automatiserad export saknas.
5. **Tool-result schemas är fortfarande klient-validerade** — `zod` schemas finns nu i `@repo/shared/schemas.ts`; backend-routes använder fortfarande Joi. Migrationen pågår.

## Reviewchecklist (per ändring som rör auth/MCP/AI)

- [ ] Lägger ändringen till en ny trust boundary? Dokumentera.
- [ ] Introduceras en ny env-var? Tillåt aldrig att den läcker till MCP-subprocess.
- [ ] Lägger ändringen till en ny GraphQL-resolver? Markera lämplig `extensions.complexity`.
- [ ] Lägger ändringen till en ny user-input-väg? Validera med zod-schema från `@repo/shared`.
- [ ] Lägger ändringen till en ny audit-trail-händelse? `intentText` ska alltid kunna logas.

## Referenser

- [`Doc/improvements.md`](../improvements.md) — Levande kritisk granskning.
- [`Doc/AI Platform Security & Stability Review.md`](../AI%20Platform%20Security%20%26%20Stability%20Review.md) — AI/MCP-specifik översikt.
- [`Doc/Security Regression Suite.md`](../Security%20Regression%20Suite.md) — Verifieringskrav.
