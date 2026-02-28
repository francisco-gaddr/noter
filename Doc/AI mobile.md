# AI Mobile Implementation Plan

## Översikt

Denna arkitektur möjliggör lokal AI på mobilen genom att använda **GGUF-modeller** direkt via `llama.rn` (Llama.cpp bindings for React Native). Detta uppfyller kravet på "automatisk konvertering" genom att eliminera behovet av komplex konvertering på enheten – vi laddar ner GGUF-filer som är redo att köras direkt.

### Arkitektur

1.  **UI Layer (React Native):** `AIScreen` (Chat, Models, History tabs).
2.  **Service Layer:**
    *   `HuggingFaceService`: Söker efter modeller på Hugging Face (filtrerar på `.gguf`).
    *   `ModelService`: Hanterar nedladdning, lagring och radering av modellfiler lokalt.
    *   `LlamaService` (`MobileLlamaProvider`): Hanterar initiering av `llama.rn`, context och inferens (chat).
3.  **Native Layer:** `llama.rn` (kör `llama.cpp` native C++ kod).
4.  **Storage:** `expo-file-system` för modellfiler, `sqlite` (via `database.ts`) för metadata och historik.

## Implementeringsplan & Progress

### Fas 1: Grundläggande Struktur & Sökning (✅ Klar)
- [x] Skapa `HuggingFaceService` i `@repo/ai` för att söka GGUF-modeller.
- [x] Implementera sök-UI i mobilappen (`ai.tsx`).

### Fas 2: Nedladdning & Lagring (✅ Klar)
- [x] **Separera nedladdningslogik:** Flyttat till `services/ai/modelService.ts`.
- [x] **Förbättra filval:** `getBestQuantization` väljer automatiskt optimal fil (Q4_K_M).
- [x] **Robust nedladdning:** Använder `FileSystem.createDownloadResumable`.
- [x] **Metadata-lagring:** Sparar modellinfo i SQLite via `saveModelLocal`.
- [x] **UI Feedback:** Tydlig progress-bar och "Finalizing..." status.

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
    *   *Verifiera:* Appen ska ladda modellen (kan ta några sekunder första gången) och sedan svara.

## Detaljerad Arbetsgång (Next Steps)

1.  **Bygg om appen:** Eftersom vi lagt till native-logik kan du behöva köra `npx expo run:android` eller `npx expo run:ios` igen.
2.  **Testa minne:** Om appen kraschar vid laddning av stora modeller (7B), testa mindre modeller (TinyLlama 1.1B) eller se över `n_ctx` i `provider.ts`.
