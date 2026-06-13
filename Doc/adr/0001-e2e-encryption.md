# ADR-0001: E2E-kryptering med Argon2id + AES-GCM v3

**Status:** Proposed — **NOT YET IMPLEMENTED** (as of 2026-06-13)
**Date:** 2026-05-14
**Author(s):** realdini

> ⚠️ **Reality check (2026-06-13):** Den v3-design som beskrivs nedan finns inte i
> koden. Det som faktiskt körs är fortfarande legacy CryptoJS AES-CBC med hårdkodad
> `DEFAULT_KEY` (dvs. exakt det som "Context" säger att vi skulle ersätta). Se
> `Doc/security/encryption-review-2026-06.md` för fullständig analys och en stegvis
> implementationsplan. Statusen sänks till *Proposed* tills `encryptV3`/`decryptV3`,
> Argon2id-key-wrap och migrationen faktiskt finns och är testade.

## Context

Användardata (notes, tasks, AI-konversationer) ska aldrig kunna läsas av
backend eller en angripare som tappat DB-dump. Tidigare implementering
använde CryptoJS AES-CBC utan autentisering och en hårdkodad
`DEFAULT_KEY` som fallback. Dessutom fanns ingen multi-device-mekanism
för att dela krypteringsnyckeln.

## Decision

- Klientkrypto byter till **AES-256-GCM** (`encryptV3`/`decryptV3`) med
  per-fält IV.
- Key-wrap använder **Argon2id** (`memoryCost: 64 MiB, timeCost: 3,
  parallelism: 1`) med graceful fallback till PBKDF2-SHA256 (200k it)
  när Argon2 inte är tillgänglig i runtimen.
- Användarens `dataKey` wrappad mot en `rootKey` derivad från password →
  serverside lagras endast `wrappedDataKey + salt + keyWrapVersion +
  keyWrapKdf`. Backenden får aldrig `rootKey` eller `dataKey` i klartext.
- Migration: alla legacy `U2FsdGVkX1`-ciphertexter migreras till v3 via
  klient-sida bakgrundsjobb (`migrateRecordsToV3`).

## Considered alternatives

- **AES-CBC + HMAC** — vi hade behövt skriva egen MAC-handling och
  IV-mgmt; AES-GCM via WebCrypto är native och autentiserat.
- **XChaCha20-Poly1305** — utmärkt val men WebCrypto stöder inte det
  cross-platform; vi väntar tills 2027 när det blir baseline.
- **PBKDF2 only** — räcker mot kort password-strength, men Argon2id är
  memory-hard mot GPU-attacker; rekommenderad standard 2026.

## Consequences

- + E2E är verkligt: server kan inte läsa innehåll.
- + Argon2id-parametrar kan bumpas i `KEY_WRAP_VERSION` utan att tappa
    bakåtkompatibilitet (`dataKeyBackup.ts` håller historik).
- − Klient-side bootstrap behöver wait på Argon2-derivation (~300 ms i
    web, ~100 ms via worker_threads på backend).
- − Lösenordsglömma → datatapp. Vi lägger en recovery-code-mekanism i en
    senare ADR.

## Implementation notes

- `packages/shared/src/{encrypt,kdf,keyBootstrap,cryptoMigration}.ts`
- `apps/backend/src/utils/argon2Worker.ts` för server-side derivation
  off-event-loop.
- Migration kör som klient-side bakgrundsjobb, inte server-side.

## Open questions

- Recovery-code-flöde (separat ADR).
- KMS-wrap-on-rest för wrappedDataKey (scaffold finns i
  `security/kmsWrap.ts`).
