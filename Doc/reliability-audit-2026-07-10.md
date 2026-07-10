# Tillförlitlighetsgranskning — hela appen (2026-07-10)

_Fyra parallella granskningsagenter (backend, mobil, web, delade paket) sökte konkreta
stabilitets-/felhanterings-/fallback-defekter med fil:rad-krav och konkret felscenario.
~45 fynd; alla åtgärdbara är fixade, testade och pushade i fyra commits
(`64a4127` shared/ai, `289d41d` backend, `21e6ae1` mobil, `7df716e` web + `b9883e6` Quick Capture)._

## Säkerhetskritiskt (fixat)
- **Låsflaggan failade ÖPPET** (`packages/shared/src/locks.ts`): en odekrypterbar ciphertext-flagga
  (ingen dataKey — t.ex. backend — eller fel nyckel) tolkades som *olåst*, vilket kunde släppa
  låst innehåll till AI/index. Nu fail-closed: endast ett explicit dekrypterat `'false'` låser upp.
- **Neo4j-grafradering vid tom input** (`neo4jSync.ts`): en sync som avfyrades innan datan laddats
  prunade mot tom keep-lista → hela användarens spegelgraf raderades. Tom *input* ⇒ ingen plan
  (tom *selektion* med data kvar är fortsatt legitim skrubbning av nyligen låst innehåll).

## Genomgående mönster som åtgärdats
1. **Deadlines överallt**: MCP-klienten (10s/60s), agentloopens modell-/verktygsanrop (300s/120s),
   backend→Neo4j/WebPush/ExpoPush (15s/10s/10s), web graphql/admin/nextcloud/mcp (15–60s),
   LM Studio-streamens stall-guard (90s per chunk). En hängd beroende-tjänst kan inte längre hänga
   en request, en AI-tur eller en agentkörning.
2. **Cache är optimering, inte beroende**: Redis-avbrott ⇒ cache-miss/no-op (med 30s
   reconnect-cooldown), aldrig 500 på notes-vägen, aldrig felad write vars save redan lyckats.
3. **Tysta förluster synliggjorda**: kastade offline-ändringar, delegerings-synk som divergerat,
   omsorteringar som failat (nu rollback + banner), bakgrundsuppdateringar som halvgått,
   modellsökfel — allt får user-facing fel istället för bara console.
4. **Atomicitet**: temp→riktig-id-bytet vid create (not/task, inkl. offline-kön) och
   projektradering körs nu i en SQLite-transaktion — appdöd mitt i kan inte längre tappa datat.
5. **Race-guards**: monotona fetch-sekvenser (reconnect/socket/init-trippelfetchen kan inte längre
   skriva över nyare state med äldre svar), null-guards i alla 8 socket-handlers.
6. **Brickning omöjliggjord**: mobil-init släpper init-guarden vid fel (retry möjlig) och varje
   lagringsläsning degraderar individuellt; inloggning failar inte på keystore-hicka.
7. **Poison-hantering**: mutations-ledgern karantänerar giftmeddelanden efter 5 försök (ack+drop
   + callback) istället för evig omkörning; korrupt flashcard-datum ⇒ due (självläkande);
   korrupt embedding-komponent ⇒ högt batchfel istället för tyst nollutfylld vektor.
8. **Felklassning**: MCP-routes skickar beroendefel till felmiddlewaren (5xx, loggat, spårat)
   istället för att maskera som 400; agent-runnern avbryter körningen om running-markören inte
   kunde skrivas (inga dubbelkörningar).

## Medvetet INTE ändrat (dokumenterade beslut)
- **Optimistisk låsning på PUT** (lost-update mellan enheter): kräver versionsfält genom hela
  E2E-krypterade synkvertikalen (klienterna kan inte jämföra krypterade updatedAt). Backlog.
- **Mongo-transaktioner för GDPR-radering**: standalone Mongo saknar dem; raderingen är istället
  omkörningsbar per konstruktion (idempotent deleteMany, User-raden sist, partial-progress-logg).
- **Inbound fileIngest-konfliktdetektering** (lokal edit vs fjärrändring): kräver contentHash i
  SyncedNoteRef-modellen; ren last-write-wins idag. Backlog med tydlig design i granskningen.

## Ny funktion från funktionsresearchen
- **Quick Capture** (Tauri): global genväg Cmd/Ctrl+Skift+N höjer appen och startar ny anteckning
  (Bear/Obsidian/Drafts-mönstret). Återanvänder Electrons `action:newNote`-kontrakt;
  `onTouchBarAction` portad med exakt form. Bäst-effort-registrering (kollision ⇒ degradering).

## Verifiering
Alla typechecks + berörda sviter gröna per commit; full svit över alla workspaces körd efter
sista committen. Tauri: 22 JS + 14 Rust + clippy `-D warnings`.
