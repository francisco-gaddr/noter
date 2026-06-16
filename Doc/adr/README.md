# Architecture Decision Records (ADR)

Den här mappen innehåller arkitektur-beslut som format Noter. Vi följer
Michael Nygards mall: kort, läsbara, immutable efter merge.

## När en ADR skrivs

- När vi väljer mellan flera tekniker (t.ex. Mongo vs Postgres, Apollo vs
  graphql-http).
- När vi *accepterar* en risk eller arkitektur-kompromiss.
- När vi ändrar en tidigare ADR — *skapa en ny* som upphäver den, ändra
  inte historiken.

## Status-livscykel

- `Proposed` — under granskning, inte beslutad
- `Accepted` — gäller
- `Deprecated` — ersatt; behåll filen som historik
- `Superseded by ADR-xxx` — ny ADR har tagit över

## Numrering

`NNNN-kort-titel.md`, sekventiellt börjande på `0001`. Lås numret när PR
mergar — om två PR:er numrerar parallellt får sista mergande hoppa till
nästa lediga.

## Lista

| Nr | Titel | Status |
|----|-------|--------|
| 0001 | [E2E-kryptering med Argon2id + AES-GCM](0001-e2e-encryption.md) | Accepted |
| 0002 | [MCP intent classification](0002-mcp-intent.md) | Accepted |
| 0003 | [GraphQL trusted documents](0003-graphql-trusted-documents.md) | Accepted |
| 0004 | [En offline-sync-kö (SQLite) med latest-wins-dedupe](0004-offline-sync-queue.md) | Accepted |
| 0005 | [Schemalagda AI-agentuppgifter](0005-scheduled-ai-agent-tasks.md) | Accepted |
| 0006 | [Kunskapsgraf + sök](0006-knowledge-graph-and-search.md) | Accepted |
| 0007 | [Desktop Electron → Tauri (beslut: vänta/spike)](0007-electron-vs-tauri.md) — körguide: [`migrations/electron-to-tauri-runbook.md`](../migrations/electron-to-tauri-runbook.md) | Accepted |
| 0008 | [Extern Markdown-sync för valda anteckningar/mappar](0008-external-markdown-sync.md) — plan: [`external-markdown-sync.md`](../external-markdown-sync.md) | Accepted (Fas 1+2 levererad) |
| 0009 | [End-to-end-kryptering för AI-skapat innehåll](0009-e2e-for-ai-created-content.md) — datakarta: [`security/ai-agent-data-handling.md`](../security/ai-agent-data-handling.md) | Accepted |

Lägg till nya rader sorterat på nummer.

## Mall

Kopiera [`TEMPLATE.md`](TEMPLATE.md) till en ny fil. Fyll i, öppna PR.
