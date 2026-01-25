# Förbättringar och Status

## Status på genomförda ändringar

### Tasks & Prioritet
- [x] **Default prioritet**: Ändrat till "medium" som förvalt värde vid skapande av nya tasks (Både mobil och webb).
- [x] **Sortering efter prioritet**: Implementerat sortering där tasks med högst prioritet hamnar överst och färdiga tasks sist.
  - Mobil: Uppdaterat `TaskList.tsx` med sorteringslogik.
  - Webb: Uppdaterat `TaskList.tsx` med sorteringslogik och UI-indikatorer.
- [x] **Offline-funktionalitet**: Säkerställt att tasks skapade offline behåller rätt prioritet och synkas korrekt.

### Drag-and-Drop & Sortering
- [x] **Persistens**: Fixat så att drag-and-drop ordning sparas korrekt mot backend (`/tasks/reorder` endpoint).
- [x] **Kalender (Webb)**: Stöd för att skapa tasks via klick i kalendern.
- [x] **Kalender (Mobil)**: Stöd för drag-and-drop och skapande av tasks i tidslinjen.
- [x] **Notes Sortering (Mobil)**: Möjliggjort drag-and-drop i trädvyn för att ändra ordning (Custom sorting).
- [x] **Nästlad Sortering**: Fixat "cross-level" drag-and-drop i mobilens trädvy så man kan flytta notes in i/ut ur mappar.

### Synk & Stabilitet
- [x] **Trippel-synk bugg**: Fixat problem där tasks skapades 3 gånger vid återanslutning. Implementerat deduplicering via `clientId` och `tempId` i synk-kön.
- [x] **Debug-loggar**: Rensat bort onödiga `console.log` i produktionskod för renare output och prestanda.
- [x] **App-lås (Mobil)**: Fixat timingen så att appen inte låser sig direkt vid task-switching utan respekterar den inställda fördröjningen (t.ex. 1h).

### Editor & Rendering
- [x] **Tabeller (Mobil)**: Lagt till renderingstöd för tabeller i `tiptap.ts` så att de visas korrekt i mobilen.
- [x] **Tabeller (Webb)**: Förbättrat `NoteEditor.tsx` för bättre hantering av tabell-klistra-in och rendering.
- [x] **Radbrytningar**: Justerat CSS i webb-editorn (`prose` klasser) för att minska marginaler och matcha mobilens utseende bättre.
- [x] **Dark Mode**: Justerat färger till lila-tema i enlighet med önskemål.

### Build & Konfiguration
- [x] **APK Build**: Konfigurerat `eas.json` och `app.json` för att kunna bygga Android APK (`preview` profil).
- [x] **Versionsnummer**: Uppdaterat build-nummer i konfigurationsfiler.
- [x] **Bundling Fix (Android)**: Åtgärdat fel med duplicerad `uuidv4` import i `useStore.ts` som orsakade krasch vid uppstart.

### Användarupplevelse (UX) & Mobil
- [x] **Autosave Notes**: Implementerat automatisk sparning av anteckningar när man lämnar vyn eller går tillbaka (utan att behöva trycka på spara/klar).
- [x] **Lock-time Inställning**: Ersatt cykel-knappen med en tydlig dropdown-meny i inställningar för val av lås-tid.
- [x] **Optimistiska Uppdateringar (Offline-first)**: 
  - Refaktorerat `createTask`, `updateTask`, `createNote`, `updateNote` i `useStore.ts`.
  - Appen sparar nu **alltid** till lokal databas och uppdaterar UI **direkt** innan nätverksanrop görs.
  - Detta eliminerar lagg och säkerställer att data sparas även om nätverket svajar precis vid skapandet.
  - Förhindrar dubbletter genom att använda optimistisk UI och temporära IDn som ersätts vid lyckad synk.

## Kvarstående / Att verifiera
- [ ] **Testning av APK**: Köra en faktisk build för att verifiera att APK genereras korrekt (kräver EAS konto/inloggning).
- [ ] **Webb Tabell Paste**: Ytterligare verifiering av komplexa tabeller från Word/Excel.

## Nya förslag på förbättringar
1. **Sökfunktionalitet**: Utöka sökningen till att inkludera innehåll i tasks, inte bara titlar.
2. **Taggar**: Lägga till stöd för #taggar i notes för enklare kategorisering.
3. **Export**: Möjlighet att exportera alla notes som PDF eller Markdown (Webb implementerat, Mobil saknas).
4. **Bilder i tasks**: Möjlighet att bifoga bilder direkt till en task.
5. **Röstanteckningar**: Möjlighet att spela in ljudklipp direkt i en note (Mobil).
6. **Biometrisk inloggning**: Lägga till stöd för FaceID/TouchID som alternativ till PIN-kod för app-låset.
