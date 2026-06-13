# ADR-0004: En offline-sync-kö (SQLite) med latest-wins-dedupe

**Status:** Accepted
**Date:** 2026-06-13
**Author(s):** realdini

## Context

Mobilappen hade *två* offline-kö-implementationer parallellt:

1. **Aktiv:** SQLite-tabellen `sync_queue` i
   [`services/database.ts`](../../noter-app/apps/mobile/services/database.ts)
   (`addToSyncQueue`/`getSyncQueue`/`removeFromSyncQueue`/`incrementSyncAttempt`)
   som dräneras av `syncOfflineChanges` i
   [`stores/useStore.ts`](../../noter-app/apps/mobile/stores/useStore.ts).
   Den är djupt inkopplad: temp-id→server-id-remappning över batchen,
   `REORDER`-operationer, at-rest-kryptering av payloaden,
   HTTP-status-baserad retry-klassning (401 stoppar, 4xx droppar, 5xx/429
   retry:ar) och dedupe via unikt index på `dedupeKeyHash`.
2. **Oinkopplad:** `services/offlineQueue.ts` + dess test — en ren,
   dependency-injicerad, fullt testad modul med dedupe, persistens och
   `installOfflineFlushOnReconnect`. **Inget i appen anropade den.**

Två köer med överlappande ansvar är en underhållsfälla: en framtida ändring
riskerar att förbättra fel kö, och läsaren vet inte vilken som är sanningen.

Vid granskningen hittades dessutom en **data-förlust-bugg** i den aktiva kön:
`addToSyncQueue` använde `INSERT OR IGNORE` mot det unika `dedupeKeyHash`-
indexet. Payloaden är hela entitetens tillstånd, så en *andra* offline-
redigering av samma not/task ignorerades tyst — kön behöll den första (äldre)
payloaden, och efter drain skrev `fetchNotes`/`fetchTasks` över den nyare
lokala kopian. Den andra redigeringen försvann.

## Decision

- **En kö.** Behåll den aktiva SQLite-`sync_queue`. Radera
  `services/offlineQueue.ts` och dess test som död kod. Att migrera till den
  oinkopplade modulen hade varit en regression — den saknar
  temp-id-remappning, `REORDER` och krypteringsflödet.
- **Latest-wins-dedupe.** Byt `INSERT OR IGNORE` mot en UPSERT
  (`ON CONFLICT(dedupeKeyHash) DO UPDATE SET … attempts = 0`) så att den
  senaste payloaden ersätter den köade och retry-räknaren nollställs (en ny
  redigering är en ny intent). Nyckellösa poster (`REORDER`, CREATE utan
  tempId/clientId) får `dedupeKeyHash = NULL` och kolliderar aldrig — SQLite
  ser NULL som distinkta i ett UNIQUE-index — så de läggs alltid till.

## Considered alternatives

- **Migrera `useStore` till `offlineQueue.ts`, radera `sync_queue`** —
  renare modul-API (injicerad executor), men måste återimplementera
  temp-id-remappning, `REORDER` och at-rest-kryptering. Stor, riskabel
  omläggning för noll funktionell vinst. Avvisad.
- **Behåll båda** — status quo. Permanent förvirring om vilken kö som gäller.
  Avvisad.
- **`INSERT OR REPLACE` i stället för UPSERT** — skulle byta radens
  `AUTOINCREMENT`-id och därmed dräneringsordningen (kön sorteras på
  timestamp, men id-byte rör om i kanttillstånd). UPSERT uppdaterar raden
  in-place och bevarar identiteten. Avvisad till förmån för UPSERT.

## Consequences

- + En enda sanning för offline-sync; läsaren vet var logiken bor.
- + Offline-redigeringar förlorar inte längre den senaste ändringen.
- + En ny redigering nollställer retry-räknaren → en tidigare transient
    misslyckad post fastnar inte i drop-läge.
- − UPSERT kräver att det unika indexet `idx_sync_queue_dedupeKeyHash`
    finns (migration redan på plats i `initDatabase`). Om indexet någonsin
    tas bort slutar `ON CONFLICT` att matcha — håll dem ihop.
- ~ `UPDATE` följt av `DELETE` av samma entitet kollapsar *inte* (olika
    dedupe-nycklar per action), så ett bortkastat PUT före DELETE kan ske.
    Korrekt men något ineffektivt; medvetet utanför scope.

## Implementation notes

- Kod: `addToSyncQueue` i
  [`services/database.ts`](../../noter-app/apps/mobile/services/database.ts).
- Dedupe-nyckel: `computeSyncDedupeKey` (CREATE nycklas på tempId/clientId;
  UPDATE/DELETE på id; REORDER → null).
- Migration: ingen ny — det unika indexet skapas redan i `initDatabase`.
- Regressionstest: `tests/database-at-rest.test.ts` låser fast att SQL:en
  använder `ON CONFLICT … DO UPDATE` och inte `OR IGNORE`.
- Verifierat: `npx jest store database-at-rest useRouteRestore` grönt (29),
  `tsc --noEmit` rent.

## Open questions

- Kollaps av `UPDATE`+`DELETE` för samma entitet (spara ett onödigt PUT).
- En äkta integrationstest mot ett riktigt SQLite-handtag som bevisar
  latest-wins end-to-end (nuvarande test verifierar SQL-formen, inte runtime).
