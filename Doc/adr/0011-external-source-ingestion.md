# ADR 0011 — Ingestion av externa filkällor (Nextcloud) som krypterad, indexerbar kontext

Status: **Proposed** · Date: 2026-06-16 · Plan: [`../nextcloud-ingestion.md`](../nextcloud-ingestion.md)
Bygger på: [ADR 0001](0001-e2e-encryption.md) (krypto), [ADR 0006](0006-knowledge-graph-and-search.md) (graf/sök), [ADR 0008](0008-external-markdown-sync.md) (DAV-mönster), [ADR 0009](0009-e2e-for-ai-created-content.md) (client-encrypt-before-send)

## Context

Användaren vill koppla sin **egenhostade Nextcloud**, välja **specifika mappar** (med
undermappar), och få deras innehåll (PDF, MD, bilder, text) **indexerat semantiskt + in i
kunskapsgrafen** och **användbart som AI-kontext enligt vald kontextnivå** — **säkert,
krypterat, bara på de utvalda mapparna**, med Neo4j nämnt som möjligt grafstore.

Två fakta ur kodkartläggningen styr beslutet:

1. **Appen är idag en DAV-*server*** (projicerar egna noter utåt via `markdav`/CalDAV). Den
   har **aldrig varit en DAV-*klient***. Ingestion kräver det omvända: en klient som *drar
   in* externa filer.
2. **Allt nedströms arbetar redan på `Note`-objekt** — `buildIndexableEntities` →
   embeddings, `buildGraph`, två-stegs-RAG (`retrieveForChat`), `contextLevels`-grindar och
   lås-grinden (`isReadableWithLocks`). Landar en extern fil som en krypterad `Note` så
   "bara funkar" sök, graf, kontextnivåer, lås och realtid.

Det finns **ingen** Neo4j/pgvector/sqlite-vec idag; grafen är in-memory + on-device-
vektorindex (medvetet E2E-val).

## Decision

### 1. Modellera ingestion som det omvända DAV-flödet — en on-device WebDAV-klient

Bygg en **on-device WebDAV-klient** (mobil/Electron/web) som PROPFIND:ar under de valda
root-mapparna och GET:ar filer med ETag-diff. Klienten kör **på enheten** (som håller
`dataKey`), inte på backend — så credentials och klartext aldrig når Noter-servern. En
backend-konnektor skulle ge schemalagd sync utan enheten på, men **bryter E2E** och tas
därför endast som senare, uttrycklig opt-in på användarens egen Pi — aldrig default.

### 2. Landa varje fil som en krypterad `Note`, återanvänd hela pipelinen

- Nextcloud-mapp → `Note{type:'project'}`; undermappar nästlas via `parentId`; filer →
  `Note{type:'note', content:<extraherad text>}`.
- Litet schema-tillägg: valfritt **`source`-fält** på `Note` (krypterad JSON, exakt som
  `links` hanteras idag) med `{origin:'nextcloud', connectionId, remotePath, remoteEtag,
  remoteModified, mimeType, syncedAt}` — för dedupe, inkrementell diff och proveniens.
  Backend lagrar det som ogenomskinlig chiffertext (`encryptText` idempotent).
- Indexering/graf/RAG/kontext/lås kräver **noll** nya specialfall — synkade noter behandlas
  som vilka noter som helst.

### 3. Bevara E2E + lås-invarianten oförändrat

- Credentials krypterade på enheten (SecureStore / safeStorage / krypterad localStorage),
  **app-lösenord** föredraget (Fas 2: OAuth2 Login Flow v2). Aldrig kontolösenordet, aldrig
  till Noter-backend.
- Innehåll krypteras med `dataKey` (`encrypt` → v3) **före** lagring — samma väg som
  AI-skapade noter (ADR 0009).
- TLS tvingas mot Nextcloud-värden (speglar WSS-regeln).
- Lås ärvs via `parentId`: en synkad mapp under en låst projektmapp filtreras bort av
  `isReadableWithLocks` i index/graf/projektion — låst synkat innehåll indexeras/grafas/
  exponeras aldrig (`ai-locked-notes`).
- Hård scope: PROPFIND endast under valda root-paths; per-mapp opt-in; radera anslutning →
  credentials wipas. Posten förs in i egress/connection-liggaren
  (`security/calendar-exposure.md`) med flagga `NEXTCLOUD_INGEST_ENABLED` +
  `/api/health/deep`-status.

### 4. Kontextnivå-styrning per anslutning

Synkade noter lyder befintliga `contextLevels`. Tillägg: per-anslutning (eller per-mapp)
`minContextLevel`, så en tung mapp t.ex. bara tas med från `standard`/`deep` — det
användaren menar med "i de sammanhang jag valt att den nivå ska användas".

### 5. Neo4j: on-device-graf som default; self-hosted Neo4j endast opt-in

1. Behåll on-device-grafen (default; E2E, ingen serverberoende).
2. On-device `sqlite-vec` + lokal grafspegel vid stora bibliotek (fortsatt E2E).
3. Self-hosted Neo4j **opt-in**: antingen *endast struktur* (noder + kant-typer, inget
   innehåll → E2E-bevarande) eller *innehåll i Neo4j* (kraftfullast, men **bryter E2E för
   den datan** → kräver uttryckligt val på användarens egen infra).

### Fasplan

- **Fas 1 (MVP):** on-device read-only-import — anslutnings-UI, mappväljare, ETag-sync,
  ingest → krypterad `Note`, auto-index + graf; `.md/.txt/kod` + `.pdf` (web/Electron);
  manuell "Synka nu"; paritet mobil + Electron/web.
- **Fas 2:** intervall-sync (bakgrunds-scheduler), mobil PDF-extraktion, bild→vision/OCR,
  `minContextLevel`, OAuth2 Login Flow v2.
- **Fas 3 (valfritt):** sqlite-vec / self-hosted Neo4j.
- **Fas 4 (valfritt):** två-vägs (skriv tillbaka som DAV-klient PUT). Default read-only.

## Consequences

- **Liten ny yta, stor funktion.** ~70 % återbruk; kärnan är WebDAV-klient + ingest →
  `Note`. Inga ändringar i graf-/sök-/RAG-/lås-kärnan.
- **E2E och lås bevaras bevisbart** — samma grindar som redan testas (`locks.test.ts`,
  `markdownVault.test.ts`, retrieval-låstestet). Servern lär sig aldrig ens att en not kom
  från Nextcloud.
- **Konsekvent med arkitekturen** (ADR 0001/0006/0008/0009): client-encrypt-before-send,
  opt-in, lås-medvetet, kill-switch i egress-liggaren.
- **Kostnader/risker:** (a) mobil PDF-extraktion är fortfarande olöst (kvar sedan ADR 0006);
  (b) on-device WebDAV-klient måste hantera nät-/auth-fel robust + stora filer; (c) Neo4j-
  med-innehåll är ett medvetet E2E-undantag som bara får ske på uttrycklig opt-in;
  (d) backend-konnektor för "sync när enheten är av" är önskvärt men E2E-brytande — medvetet
  uppskjutet.
- **Öppna beslut** (avgörs innan Fas 1 låses): lagringsmodell (krypterade Notes vs enbart
  on-device-index), riktning (read-only vs två-vägs), klientplats (on-device vs backend).
  Rekommendation i [`../nextcloud-ingestion.md`](../nextcloud-ingestion.md): krypterade
  Notes, read-only först, on-device-klient.
