# Offline-first förbättringsinventering (Web + Mobil)

## Målbild
- Appen ska alltid vara användbar utan nät: skapa/ändra/radera notes och tasks ska alltid kännas omedelbart.
- Synk ska ske i bakgrunden och aldrig blockera UI.
- Konflikter ska hanteras deterministiskt och begripligt (utan dataförlust).

## Nuvarande läge (sammanfattning)
- Web: IndexedDB-cache + pendingSync-flaggor + synk vid online.
- Mobil: SQLite (expo-sqlite) + syncQueue (CREATE/UPDATE/DELETE/REORDER) + NetInfo-styrd synk.
- Backend: REST + Socket.IO events.

## Förbättringar – Gemensamma (Web + Mobil)
### Synk & konflikter
- Inför enhetlig “last-write-wins” per fält eller per dokument med `updatedAt` + `clientUpdatedAt` (clienten sätter, backend validerar).
- Lägg till `revision`/`etag` (t.ex. increment) för att upptäcka write-write konflikter tidigt.
- Skilj på “optimistic UI” och “confirmed state”: markera lokalt ändrade objekt med status (pending / syncing / failed) och visa diskret UI.
- Batcha synk-kö (skicka flera updates per request) för bättre prestanda och färre race conditions.
- Idempotens överallt: använd `clientId`/`requestId` i både create note/task och update för att undvika dubletter vid retries.

### Offline-robusthet
- Standardisera timeouts/retries (och backoff) för alla nätanrop, inklusive Socket.IO reconnect.
- Normalisera datatyper vid gränsen: booleans/dates ska alltid serialiseras konsekvent (särskilt `completed`, `dueDate`).
- Spara aldrig “trasig” selection/state efter mutationer (t.ex. editor/table) – återställ till en stabil plats.

### Datastruktur & index
- Indexera lokalt på `updatedAt`, `parentId`, `type` och för tasks även `parentNoteId`, `dueDate`, `completed`.
- Lägg till server-side endpoints för delta-synk: `GET /notes?since=<timestamp>` och `GET /tasks?since=<timestamp>` för snabb rehydrering.

### Attachment/Media
- Inför explicit hantering av bilagor: separata endpoints + hashad filcache lokalt.
- För offline: queue:a uppladdningar och rendera “placeholder” tills uppladdning är bekräftad.

## Förbättringar – Web
### IndexedDB & service worker
- Lägg till “write-ahead log” per entity (notes/tasks) istället för ad hoc pendingSync-flaggor (gör replay mer robust).
- Utnyttja Background Sync (om PWA) för att synka även när tabben inte är aktiv.
- Se till att SW-cache inte maskerar backendfel (tydliga “API unreachable”-states).

### Realtid (Socket.IO)
- Bygg dedupe på server events med event-id + ack (undvik dubbel-inject vid reconnect).
- Vid reconnect: gör alltid en snabb delta-synk för att fånga missade events.

## Förbättringar – Mobil
### SyncQueue
- Inför prioritet i kön (t.ex. AUTH/NOTE/TASK) och gruppera upprepade UPDATE på samma id (komprimera).
- Hantera “parent mapping” konsekvent: om parent ännu är temp, håll barn-ops tills parent är bekräftad.
- Lägg in “poison pill”-logik: om en op får 4xx som aldrig kan lyckas (validation), markera som failed och visa UI med åtgärd.

### Nät & bakgrund
- Integrera expo-background-fetch/expo-task-manager för periodisk synk när nät blir tillgängligt.
- Lägg till en enkel offline-indikator i UI + “Synkar…” status.

## Förbättringar – Backend (för offline-first)
- Acceptera både legacy- och nya format i validering (t.ex. boolean/string) men normalisera internt.
- Lägg till bulk-endpoints: `/sync/notes` och `/sync/tasks` som tar listor av operations och returnerar mapping + resultat.
- Lägg till delta-endpoints (since) och ett konsekvent `updatedAt` kontrakt.
- Emit events per user-room istället för global broadcast (`io.to(userId)`), så klienter inte får irrelevant data.

## Rekommenderad nästa implementation (stegvis)
1) Delta-synk + robust idempotens (clientId/requestId) för notes & tasks.
2) Komprimerande syncQueue (coalesce UPDATE) + bättre felstatus i UI.
3) Bulk sync endpoints + user-scoped socket rooms.
4) Background sync (web PWA + mobil background fetch).

