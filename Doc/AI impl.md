# Implementeringsplan för Lokal AI-agent med MCP-integration

Denna implementeringsplan är strukturerad som en hierarkisk lista av tasks och subtasks, baserat på PRD:n. Planen utgår från att grundläggande app-struktur (React Native för mobil, Next.js för web), CI/CD-pipeline och traditionell funktionalitet för anteckningar/tasks redan finns. Alla AI-relaterade funktioner implementeras som tillägg ovanpå detta, med utveckling utförd av en AI-agent. Tasks är nedbrutna för att täcka alla aspekter i PRD:n, med fokus på modulär utveckling, testbarhet och plattformsspecifika anpassningar. Varje task/subtask har en checkbox [ ] för avcheckning.

Huvudtasks följer PRD:s (AI PRD.d) struktur för logik, med gemensamma komponenter (t.ex. delad logik via shared libraries) följt av plattformsspecifika implementationer. 

Efter implementation av kärnfunktioner, integreras säkerhet, prestanda och konfiguration som cross-cutting concerns.


## 1. Förberedelser och Setup
[x] **Konfigurera utvecklingsmiljö för AI-agentutveckling**  
    [x] Installera llama.cpp och relaterade beroenden i en delad repo för både React Native och Next.js.  
    [x] Skapa en shared library (t.ex. via npm package) för gemensam AI-logik, inklusive tool-calling och entitetshantering.  
    [ ] Uppdatera CI/CD-pipeline för att inkludera AI-specifika tester (unit, integration) och plattformsspecifika builds.  
    [ ] Definiera enhetstest-ramverk för tool calls och modellinteraktion (t.ex. Jest för JS/TS).  

[x] **Definiera databas-schema och kryptering**  
    [x] Utöka befintlig lokal databas (t.ex. SQLite eller Realm för mobil, IndexedDB för web) med tabeller för AI-entiteter (konversationer, modeller, MCP-tjänster).  
    [x] Implementera end-to-end-kryptering för all ny data (använd CryptoJS eller motsvarande för cross-plattform).  
    [x] Skapa unika ID-generering och spårbarhet för entiteter (anteckningar, tasks, projektmappar, tasklistor).  

## 2. Implementera Kärnfunktioner
### 2.1 Lokal Modellkörning
[x] **Integrera llama.cpp för lokal inferens**  
    [x] Skapa en bridge för llama.cpp i React Native (använd native modules för iOS/Android).  
    [x] Implementera llama.cpp i Next.js via Node runtime eller WebAssembly för web-kompatibilitet.  
    [x] Stöd för GGUF-modeller: Lägg till parsing och laddning av modeller i shared library.  
    [ ] Implementera dynamiskt modellval: Skapa UI-komponent för val av aktiv modell i chatt-menyn (mobil) och sidopanel (web).  

[x] **Konfigurerbara parametrar och streaming**  
    [ ] Skapa konfigurationsobjekt för parametrar (temperature, top_p, etc.) med default-värden.  
    [x] Implementera token-streaming: Använd observables (t.ex. RxJS) för realtidsuppdatering utan UI-blockering.  
    [x] Lägg till systemprompt-hantering: Tillåt ändring via inställningar, lagra i krypterad databas och se till att det tas med i kommunikation med AIn.  
    [ ] Optimera för GPU-layers och threads: Detektera enhetens kapacitet och justera dynamiskt.  

### 2.2 Hugging Face-integration
[x] **Integrera Hugging Face API för modellhantering**  
    [x] Skapa API-klient i shared library för sökning, filtrering och nedladdning (använd fetch/axios).  
    [x] Implementera filtrering: Arkitektur, kvantisering, filtyp, storlek – bygg query-parametrar.  
    [x] Visa modellinfo: Storlek, kontextlängd, licens, beskrivning i en lista-komponent.  

[ ] **Användarinteraktion för modeller**  
    [ ] Skapa UI för nedladdning av flera modeller: Progress-bar och bakgrundsdownloads.  
    [ ] Implementera växling av aktiv modell: Uppdatera llama.cpp-instans vid byte.  
    [ ] Lägg till borttagning av modeller: Rensa lokal lagring och uppdatera UI.  
    [ ] Integrera i chatt-menyn (mobil) och sidopanel (web).  

### 2.3 AI-agentfunktionalitet
[x] **Implementera agent-logik med tool-calling**  
    [x] Skapa agent-core i shared library: Tolka intention, avgör verktygsbehov, hantera JSON-format för tool calls.  
    [x] Definiera interna tool-functions: För entitetshantering (skapa/uppdatera/läsa).  
    [x] Integrera MCP-tool calls: Mappa till externa tjänster.  
    [x] Testa tool-calling: Skapa mock-scenarier för intentionstolkning.  
    [x] Varje gång AIn använder en tool call ska detta listas i AI chatten så att det tydligt står vilken tool call som ahar använts.
    

[ ] **Hantera agent-interaktion**  
    [ ] Implementera chatt-gränssnitt: Menyval i mobilapp. Utfällbar/resizable sidopanel i webapp.  
    [ ] Stöd för streaming-responses: Uppdatera UI i realtid vid inferens.  
    [ ] Lägg till felhantering: Återförsök vid misslyckade tool calls.  

### 2.4 AI Entitetshantering
[x] **Definiera entitetsschema och validering**  
    [x] Skapa JSON-schemas för anteckningar, tasks, projektmappar, tasklistor.  
    [x] Implementera schema-validering (t.ex. med AJV) i tool calls.  
    [ ] Lägg till versionshantering: Track changes med timestamps och revisions.  
    [x] Varje gång AIn använder en tool call ska detta listas i AI chatten så att det tydligt står vilken tool call som ahar använts.
    
[x] **Implementera CRUD via tool calls**  
    [x] Skapa tools för skapande: Generera unikt ID, lagra krypterat.  
    [x] Implementera uppdatering: Hämta, modifiera, spara med validering.  
    [x] Lägg till hämtning: Sök och returnera entiteter till agenten.  
    [ ] Integrera spårbarhet: Logga alla förändringar i krypterad databas.  
    [x] Varje gång AIn använder en tool call ska detta listas i AI chatten så att det tydligt står vilken tool call som ahar använts.
     
        

### 2.5 MCP-integration
[x] **Implementera MCP-protokoll**  
    [x] Skapa MCP-klient i shared library: Dynamisk registrering av tjänster.  
    [ ] Bygg konfigurationspanel: UI för varje tjänst med funktioner, behörigheter, verktyg.  
    [x] Definiera JSON-schema för funktioner: Mappa till AI-tool calls.  

[ ] **Integrera specifika tjänster**  
    [ ] Implementera Notion-integration: OAuth, tokenlagring (krypterad), funktionsmappning.  
    [ ] Lägg till Slack: OAuth, API-calls via MCP.  
    [ ] Integrera Google Assistant, Gmail, Google Calendar: OAuth-hantering, krypterad tokenlagring.  
    [ ] Skapa test-moduler: Enhetstester för varje integration.  

## 3. Implementera Konversationssystem
### 3.1 Trådbaserad historik
[x] **Skapa trådhantering**  
    [x] Implementera databas-tabell för trådar: Unikt ID, krypterad lagring.  
    [ ] Lägg till UI för hantering: Byta, radera, exportera trådar.  
    [ ] Stöd för parallella konversationer: Växla mellan trådar i chatt-gränssnittet.  

### 3.2 Minne
[x] **Implementera minnesystem**  
    [x] Skapa korttidsminne: Per konversation, lagra i session.  
    [ ] Integrera långtidsminne: Via entiteter, hämta kontext.  
    [ ] Lägg till kontextåterhämtning: Automatisk laddning vid trådbyte.  
    [ ] Implementera redigerbart minne: UI för att editera lagrad data.  

## 4. Integrera Säkerhet
[x] **Applicera end-to-end-kryptering**  
    [x] Kryptera konversationer, entiteter och tokens: Använd AES eller motsvarande i shared library.  
    [x] Säkerställ lokal lagring: Inga externa calls för inferens.  
    [x] Ta bort dold telemetri: Granska kod för att säkerställa ingen tracking.  

## 5. Optimera Prestanda
[x] **Hantera prestandakrav**  
    [x] Implementera token-streaming: Asynkron utan UI-block.  
    [x] Optimera för mobil: Testa på 8-12 GB RAM, använd bakgrundstrådar.  
    [ ] Lägg till minneshantering: Automatisk unload av modeller.  
    [ ] Bakgrundsoptimering: Schemalägg modellhantering i idle-tid.  

## 6. Plattformsspecifika Implementationer
### React Native (Mobil)
[x] **Native-specifika features**  
    [x] Bygg native bridge för llama.cpp: Inferens i bakgrundstrådar.  
    [x] Implementera krypterad lagring: Använd Secure Storage.  
    [x] Integrera chatt-menyval: Lägg till navigation och UI-komponent.  

### Next.js (Web)
[x] **Web-specifika features**  
    [x] Implementera modellkörning: Via Node eller WASM för isolerad process.  
    [x] Säker filhantering: Använd localStorage/IndexedDB med kryptering.  
    [x] Bygg sidopanel: Utfällbar, resizable med CSS/JS.  

## 7. Implementera Konfigurationssystem
[ ] **Skapa konfigurations-UI**  
    [ ] Bygg panel för modellhantering: Nedladdning, val, borttagning.  
    [ ] Lägg till MCP-konfig: Registrering, panel per tjänst.  
    [ ] Implementera AI-parametrar: Sliders/inputs för temperature etc.  
    [ ] Hantera minne och lagring: UI för policy och export.  

[ ] **Versionshantering för inställningar**  
    [ ] Lagring av inställningar: Krypterad, exporterbar JSON.  
    [ ] Versionskontroll: Track changes med diffs.  

## 8. Testning och Deployment
[ ] **Genomför omfattande testning**  
    [x] Unit-tester för tool calls, entiteter och MCP.  
    [x] Integrationstester: End-to-end för chatt och inferens.  
    [ ] Prestandatester: På målhårdvara för mobil och web.  
    [x] Säkerhetstester: Kryptering, ingen extern data-leak.  

[ ] **Deployment och rollout**  
    [ ] Uppdatera CI/CD för AI-features: Bygg, test, deploy.  
    [ ] Skapa release-notes: Dokumentera nya features baserat på PRD.  
    [ ] Monitora post-release: Implementera lokal logging för felrapportering.