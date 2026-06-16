# ADR-0009: End-to-end-kryptering för AI-skapat innehåll

**Status:** Accepted — implementerad 2026-06-16
**Date:** 2026-06-16
**Author(s):** Noter team

## Context

Anteckningar/uppgifter som användaren **skriver för hand** krypteras på enheten innan de
lämnar appen (klient-E2E, [`adr/0001-e2e-encryption.md`](./0001-e2e-encryption.md)). Men
anteckningar som **AI-agenten** skapade via chattens verktyg (`create_note`, `create_task`,
m.fl.) gick en annan väg: verktyget skickade **klartext** till GraphQL-mutationen, och
backend krypterade fältet serverside med den delade nyckeln (`encryptText` → `encrypt()` →
`DEFAULT_KEY`). Följden: servern såg AI-skapat innehåll i klartext (i transit + i resolvern)
och lagrade det under en nyckel servern själv håller — alltså **inte** zero-knowledge, till
skillnad från handskrivna noter.

Detta upptäcktes vid en direkt säkerhetsfråga från användaren och bedömdes som en reell
E2E-lucka som skulle stängas på det allra säkraste sättet, oavsett hur eller var data skapas.

## Decision

1. **Klienten krypterar AI-skapat innehåll på enheten** innan GraphQL-mutationen.
   `e2eNoteInput` / `e2eTaskInput` (i `apps/mobile/app/(tabs)/ai.tsx` och
   `apps/web/components/AISidebar.tsx`) kör `encrypt()` på `title`, `content`, `tags`
   (+ task `description`) för create/update av note/project/tasklist/task. `encrypt()`
   använder v3 AES-256-GCM med användarens nyckel när E2E är inrullad, annars det äldre
   schemat — identiskt med en handskriven not.
2. **Backend `encryptText` görs idempotent** (`apps/backend/src/graphql/schema.ts`): värden
   som redan är chiffertext (`isAnyCiphertext` — v3 eller legacy) släpps igenom **oförändrade**;
   bara äkta klartext krypteras serverside (full bakåtkompatibilitet). Servern avkrypterar
   eller omkrypterar aldrig användar-chiffertext.
3. **Tool-result-trace** byggs från AI:ns egna klartext-argument + nytt `_id` (inte den
   E2E-krypterade serverresponsen), så kort + AI:ns nästa tur visar läsbar bekräftelse, inte
   chiffertext.

## Consequences

- **Positivt:** servern kan aldrig läsa AI-skapade noter/uppgifter (titel/innehåll/taggar/
  beskrivning) — i transit eller i vila, på någon enhet. Samma zero-knowledge-garanti som
  handskrivna noter. Realtidssynken (lokal `ingestServer*` + WSS-broadcast) bevaras; bara
  enheter med nyckeln dekrypterar.
- **Bakåtkompatibelt:** äldre AI-noter (skapade före ändringen) ligger under den gamla
  nyckeln; de fortsätter dekrypteras via `safeDecrypt`-dispatchen. Ingen migration krävs.
- **Förbehåll:** (a) E2E-styrkan beror på att användaren är v3-inrullad — annars samma äldre
  schema som handskrivna noter i det läget. (b) Moln-AI-leverantörer ser innehållet under
  *genereringen*; det är skilt från lagringskrypteringen (lokal modell undviker det helt).
- **Test:** `apps/backend/__tests__/graphql-tools.test.ts` låser garantin (v3 lagras
  oförändrat; klartext krypteras fortfarande i vila).

Full datakarta: [`../security/ai-agent-data-handling.md`](../security/ai-agent-data-handling.md).
