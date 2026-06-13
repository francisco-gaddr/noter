# ADR-0003: GraphQL trusted documents

**Status:** Accepted
**Date:** 2026-05-14
**Author(s):** realdini

## Context

Open GraphQL-endpoints är högvärdiga angreppsmål: depth-bombs, alias-
attacks, introspection-recon. Vi vill behålla GraphQL för intern
type-safety men minimera external angreppsyta.

## Decision

- I produktion accepterar `/api/graphql` *bara* operations vars SHA-256
  matchar en allowlist genererad vid build (`graphql-allowlist.json`).
- Allowlist byggs av `apps/web/codegen.ts` + `routeHashes.cjs` plugin.
- Apollo Server v4 sköter persisted-queries-cache via Redis-store
  (`graphql/persistedQueriesStore.ts`) — `apq:`-prefix, 7d TTL.
- Klienten skickar `Authorization`-header + `query=<hash>` istället för
  fulla query-strängar.

## Considered alternatives

- **APQ (Automatic Persisted Queries) only** — APQ är populärt men
  tillåter server att lära sig nya queries on-the-fly; trusted documents
  är striktare.
- **Stänga av GraphQL helt** — vi använder type-safe queries i AI tool-
  chain; trusted documents är rätt balans.

## Consequences

- + Drastisk minskning av angreppsyta i prod.
- + Persisted queries är fingerprint av varje release-build → vi kan
    revoke:a en compromised klient genom att rotera nyckeln.
- − Dev-flöde kräver att codegen körs vid build; en glömd codegen
    ger 403 på inte-allowlist:ade queries.

## Implementation notes

- `apps/backend/src/graphql/trustedDocuments.ts` middleware mountad före
  graphql-handlern.
- `GRAPHQL_TRUSTED_DOCUMENTS_ENFORCE=false` env för dev-bypass.
- `npm run codegen` i web skriver `apps/backend/graphql-allowlist.json`.
