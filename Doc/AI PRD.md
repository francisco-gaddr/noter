````md
# Produktkravdokument (PRD)  
## Lokal AI-agent med MCP-integration  
### Plattformar: React Native (iOS/Android) + Next.js (Webb)

---

## 1. Översikt

Systemet ska via ett chtt-menyval tillhandahålla en lokal AI-agent som körs direkt på användarens enhet via llama.cpp.  
Lösningen ska finnas som:

- Mobilapp byggd i React Native  (med ett menyval för chatt med AIn)
- Webbapplikation byggd i Next.js (en sidopanel till höger i webappen som ska gå att fälla ut och in och resize) 

AI-agenten ska:

- Köra valfri nedladdad modell lokalt  
- Agera som agent med verktygsanrop  
- Hantera och redigera entiteter (Anteckningar, tasks, projektmappar och tasklistor) 
- Integrera externa tjänster via MCP  
- Lagra konversationshistorik lokalt med full kryptering  

Ingen modellinferens får ske via extern server.

---

## 2. Kärnfunktioner

### 2.1 Lokal modellkörning

- Integration med llama.cpp
- Stöd för flera GGUF-modeller
- Dynamiskt val av aktiv modell
- Stöd för streaming tokens
- Konfigurerbara parametrar:
  - temperature
  - top_p
  - top_k
  - max_tokens
  - context_size
  - threads
  - gpu_layers om tillgängligt
  - Systemprompt för att guida agenten som kan ändras via inställnignarna för AI chatten

---

### 2.2 Hugging Face-integration

Integration mot :contentReference[oaicite:0]{index=0} API.

Funktioner:

- Sökning av modeller
- Filtrering på:
  - Arkitektur
  - Kvantisering
  - Filtyp
  - Storlek
- Nedladdning av modeller
- Visning av:
  - Modellstorlek
  - Kontextlängd
  - Licens
  - Beskrivning

Användaren ska kunna:

- Ladda ner flera modeller
- Växla aktiv modell
- Ta bort modeller

---

### 2.3 AI-agentfunktionalitet

AI ska kunna:

- Tolka användarintention
- Avgöra när verktygsanrop krävs
- Anropa interna funktioner via tool calls
- Anropa MCP-tjänster
- Skapa, uppdatera och läsa entiteter med koppling mot databasen via tool call

Agenten ska stödja strukturerat tool-calling-format:

```json
{
  "tool": "function_name",
  "arguments": {}
}
````

---

### 2.4 AI Entitetshantering
Anteckningar, tasks, projektmappar för antecknignar och tasklistor.
AI-Systemet ska via tool callings stödja:

* Skapande av nya entiteter
* Uppdatering av befintliga entiteter
* Hämtning av känd information
* Versionshantering
* Strikt schema-validering

Entiteter (Anteckningar, tasks, projektmappar för antecknignar och tasklistor) ska:

* Lagrass lokalt
* Vara krypterade
* Ha unika ID
* Vara spårbara

---

### 2.5 MCP-integration

Systemet ska stödja MCP som standardprotokoll för AI-tjänstkommunikation.

Funktioner:

* Dynamisk registrering av MCP-tjänster
* Konfigurationspanel för varje tjänst
* Tydlig lista över:

  * Tillgängliga funktioner
  * Behörigheter
  * Verktyg
* JSON-baserat funktionsschema

Första basintegrationer:

* Notion
* Slack
* Google Assistant
* Gmail
* Google Calendar

Krav:

* OAuth-hantering
* Tokenlagring krypterad
* Tydlig funktionsmappning mellan MCP och AI
* Testbar och modulär arkitektur

---

## 3. Konversationssystem

### 3.1 Trådbaserad historik

* Flera parallella konversationer
* Unikt ID per tråd
* Lokalt lagrad och lagrad i databas (end to end kryptering)
* Fullt krypterad
* Möjlighet att:

  * Byta tråd
  * Radera tråd
  * Exportera tråd

---

### 3.2 Minne

Systemet ska stödja:

* Korttidsminne per konversation
* Långtidsminne via entiteter
* Kontextåterhämtning
* Redigerbart minne



---

## 4. Säkerhet

* Full lokal datalagring
* End-to-end-kryptering av:

  * Konversationer
  * Entiteter
  * OAuth-tokens
* Ingen extern inferens
* Ingen dold telemetri

---

## 5. Prestandakrav

* Token-streaming utan UI-blockering
* Stabil drift på mobil med 8 till 12 GB RAM
* Effektiv minneshantering
* Bakgrundsoptimering för modellhantering

---

## 6. Plattformsspecifika krav

### React Native

* Native bridge till llama.cpp
* Bakgrundstrådar för inferens
* Krypterad lokal lagring

### Next.js

* Lokal modellkörning via:

  * Node runtime
  * WebAssembly där möjligt
* Isolerad modellprocess
* Säker lokal filhantering

---

## 7. Konfigurationssystem

Användaren ska kunna:

* Hantera modeller
* Hantera MCP-tjänster
* Justera AI-parametrar
* Hantera minne
* Hantera lagringspolicy

Alla inställningar ska vara:

* Tydliga
* Versionshanterade
* Exporterbara
