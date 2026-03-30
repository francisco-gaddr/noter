# AI Mobile Implementation Plan

## Översikt

Denna arkitektur möjliggör lokal AI på mobilen genom att använda **GGUF-modeller** som laddas ner, konverteras till **MLC-paket** och därefter valideras innan de aktiveras i appen. Flödet stöder lokal device-konvertering när native-stödet finns och faller annars tillbaka till bakgrundskonvertering via server med tydlig status i UI.

### Arkitektur

1.  **UI Layer (React Native):** `AIScreen` (Chat, Models, History tabs).
2.  **Service Layer:**
    *   `HuggingFaceService`: Söker efter modeller på Hugging Face (filtrerar på `.gguf`).
    *   `ModelService`: Hanterar nedladdning, lagring och radering av modellfiler lokalt.
    *   `LlamaService` (`MobileLlamaProvider`): Hanterar initiering av `llama.rn`, context och inferens (chat).
3.  **Native Layer:** MLC-runtime + native brygga för modelladdning, lokal konvertering och inferens.
4.  **Storage:** `expo-file-system` för modellfiler, `sqlite` (via `database.ts`) för metadata och historik.

## Implementeringsplan & Progress

### Fas 1: Grundläggande Struktur & Sökning (✅ Klar)
- [x] Skapa `HuggingFaceService` i `@repo/ai` för att söka GGUF-modeller.
- [x] Implementera sök-UI i mobilappen (`ai.tsx`).

### Fas 2: Nedladdning, konvertering & validering (✅ Klar)
- [x] **Separera nedladdningslogik:** Flyttat till `services/ai/modelService.ts`.
- [x] **Förbättra filval:** `getBestQuantization` väljer automatiskt optimal fil (Q4_K_M).
- [x] **Robust nedladdning:** Använder `FileSystem.createDownloadResumable`.
- [x] **Metadata-lagring:** Sparar modellinfo i SQLite via `saveModelLocal`.
- [x] **UI Feedback:** Tydlig progress-bar och "Finalizing..." status.
- [x] **Automatisk paketvalidering:** Efter unzip/konvertering söker appen upp faktisk paketrot med `mlc-chat-config.json` även om zip-filen innehåller extra toppmapp.
- [x] **Bakgrundsflöde:** Nedladdning och konvertering fortsätter i bakgrunden och kan återupptas från installerad modellväg.
- [x] **Runtime-gating:** Modeller får inte installeras eller aktiveras om MLC-runtime saknas i den installerade native-builden.
- [x] **Krypterad AI-historik:** Användarmeddelanden, assistentsvar och tool-use-historik sparas krypterat lokalt och i AI-sync.

### Fas 3: Lokal Inferens (Chat) (✅ Klar)
- [x] **Uppdatera `MobileLlamaProvider`:**
    - [x] Stöd för att byta modell (`unloadModel` implementerad).
    - [x] Hanterar context och fel.
    - [x] CPU fallback för maximal kompatibilitet.
- [x] **Koppla UI till Provider:**
    - [x] Chatten laddar vald modell automatiskt.
    - [x] Stöd för chat-historik och formattering.

### Fas 4: Optimering & Polering (🚧 Nästa steg)
- [ ] **Minneshantering:** Se till att modellen laddas ur när appen går till bakgrunden.
- [ ] **Prompt Templates:** Mer avancerad hantering av olika chat templates.
- [x] **Android native MLC-konverteringsbrygga:** Reflektionsbaserad integration mot MLC SDK-klasser.
- [x] **Device-E2E för lokal konvertering:** Android instrumenteringstest som validerar att `mlc-chat-config.json` skapas.
- [x] **AI-bakgrundsläge:** Inställning i AI-systemfliken för att tillåta pågående AI-generering i bakgrunden.
- [x] **Tydlig stoppkontroll i chatten:** Separat stop-knapp visas under pågående generering.

## Verifiering (Så här testar du)

1.  **Starta appen** och gå till **AI**-fliken.
2.  Välj **Models** i toppen.
3.  Sök efter t.ex. `Mistral` eller `TinyLlama`.
4.  Tryck **Download** på en modell.
    *   *Verifiera:* Progress-baren ska gå från 0% till 100%.
    *   *Verifiera:* Knappen ska visa "Finalizing..." kort innan modellen dyker upp under "Local Models".
5.  Tryck **Select** på den nedladdade modellen.
6.  Gå till **Chat**-fliken.
7.  Skriv "Hello" och skicka.
    *   *Verifiera:* Appen ska först validera modellpaketet.
    *   *Verifiera:* Om GGUF behöver konverteras ska status tydligt visa nedladdning, konvertering och slutförande.
    *   *Verifiera:* Appen ska ladda modellen och sedan svara utan felet "Modellpaketet är ogiltigt eller saknar filer".

## Felsökning

- Om modellen redan finns lokalt men ligger i en zip-rot med extra undermapp, ska appen automatiskt hitta rätt paketrot i stället för att kräva ominstallation.
- Om lokal konvertering inte stöds i aktuell build ska appen tydligt fortsätta med serverkonvertering och fortfarande visa progress.
- Om modellen inte kan valideras efter nedladdning ska användaren få tydligt fel i UI i stället för tyst misslyckande i chattflödet.
- Om dekryptering av AI-sync misslyckas ska appen maska värdet i stället för att visa rå ciphertext i chatthistoriken.

## Detaljerad Arbetsgång (Next Steps)

1.  **Bygg om appen:** Eftersom vi lagt till native-logik kan du behöva köra `npx expo run:android` eller `npx expo run:ios` igen.
2.  **Testa minne:** Om appen kraschar vid laddning av stora modeller (7B), testa mindre modeller (TinyLlama 1.1B) eller se över `n_ctx` i `provider.ts`.

## Device-E2E (Android lokal konvertering)

1.  Bygg dev client med native-modulen och MLC SDK inkluderad.
2.  Placera en test-GGUF på enhetens filsystem.
3.  Kör instrumentering:
    ```bash
    npm run test:android:mlc-device-e2e
    ```
4.  För att köra faktisk konvertering, sätt instrumentation arguments:
    - `mlcInputPath`
    - `mlcOutputPath`
    - `mlcQuantization` (valfritt, default `Q4_K_M`)

## AI i bakgrunden (mobil)

1.  Öppna **AI → Systemprompt**.
2.  Slå på **Tillåt AI-arbete i bakgrunden**.
3.  Starta en AI-generering och lås skärmen eller lägg appen i bakgrunden.
4.  För att avbryta pågående generering, använd **Stoppa generering** i chatten.

## Nya AI-funktioner

- **Backend-sync för AI-chattar kan nu slås av helt i AI-inställningarna.**
  - När sync är avstängd stannar chattar och AI-projekt på enheten.
  - Lokal historik fortsätter lagras krypterat at rest i SQLite.
  - Appen skippar pull/push av AI-sync och startar inte realtime-refresh för AI-sync.
- **Promptprofil kan väljas i AI-inställningarna.**
  - Profilerna `Balanserad`, `Research`, `Utförande` och `Kortfattad` kombineras med användarens systemprompt och projektprompt.
  - Målet är att ge bättre styrning utan att användaren behöver skriva om hela systemprompten varje gång.
- **Tool-use har nu två säkerhetslägen.**
  - `Endast läsning` tillåter listning, hämtning och sammanfattning.
  - `Full åtkomst` krävs för skapande, uppdatering, borttagning och skrivande MCP-anrop.
- **Sessionsinsikter visas i AI-inställningarna.**
  - Visar vald provider, modell, sync-läge, tool-use-läge, promptprofil och aktiva MCP-tjänster.
  - Detta gör felsökning och verifiering snabbare för användaren.
- **GGUF → MLC-pipelinen är nu härdad.**
  - Mobilen använder backendens gemensamma konverteringsjobb via web-proxy i stället för att förlita sig på en separat lokal Next-konverterare.
  - Hälsokontrollen visar nu även upplöst MLC-kommando och installationshint om binären inte kan startas.
  - Efter färdig installation valideras modellen, aktiveras automatiskt och är direkt redo för chatt.

## Motivering

- **Global sync-toggle** gör AI-chattar förenliga med strikt lokal sekretess när användaren inte vill dela AI-historik med backend.
- **Promptprofiler** gör AI-beteendet mer användbart direkt i UI utan att kräva manuell prompt-engineering.
- **Read-only tool-use** minskar risken för oavsiktliga ändringar när användaren vill ha AI-stöd för analys men inte för mutationer.
- **Sessionsinsikter** gör det tydligt vilken AI-konfiguration som faktiskt används i stunden, vilket minskar felsökningstid.
- **Härdad GGUF-pipeline** minskar Windows-specifika fel som `spawn mlc_llm ENOENT` och gör det tydligare varför konvertering lyckas eller blockeras.
