# Förbättringar

- [x] 1. Mobilappen ger fel `ReferenceError: Property 'ScrollView' doesn't exist` i `TaskTimeline.tsx`.
- [x] 2. Mobilappen: Visa SVG-symbol för projektmappen i headern. Long-press för att ändra.
- [x] 3. Webbappen: Notes-sektionen visar projektmappar i listan med notes (ska döljas).
- [x] 4. Webbappen: Drag & drop i projektmapp ska inte ta bort noten från mappen.
- [x] 5. Webbappen: Filtrera tasks på status (alla, klara, aktiva).
- [x] 6. Mobilappen: Sorteringsikonen i headern slutar fungera efter 2 tryck.
- [x] 7. Webbappen: Fixa saknade översättningsvärden (projekt.label, projekt.allNotes, sort.custom, etc).
- [x] 8. Säkerhet: Kryptera task status och priority (Kräver schema-migrering, se `säkerhetsrapport.md`).
- [x] 9. Säkerhet: Full kryptering av notes och tasks i local storage, transit och DB (Delvis klart, metadata kvar).
- [x] 10. Säkerhet: Inventering och rapport (`säkerhetsrapport.md`).
- [x] 11. Format: Stöd för tabeller i anteckningar (mobil & webb).
- [x] 12. Webbappen: Stäng dialogrutor med klick utanför eller ESC.
- [x] 13. Mobilappen: Kalendervy ska stödja dag, vecka, månad, agenda.
- [x] 14. Mobilappen: Drag & drop i list/kortvy för notes (aktiverar "custom" sortering).
- [x] 15. Mobilappen: Ändra projektmapp för en note i inställningar (redigeraren).
- [x] 16. Mobilappen: Visa projektmappens namn i headern istället för "notes".
- [x] 17. Mobilappen: Visa default-SVG för notes i kortvy om ingen vald.
- [x] 18. Mobilappen: Fixa dubbla ikoner i trädvy för notes.
- [x] 19. Mobilappen: "Alla notes" i trädvy visar inte alla anteckningar (fixat genom att visa projekt även i trädvy).
- [x] 20. Mobilappen: Byta SVG-symbol för projektmappar, anteckningar och tasklistor.

## Nya förbättringar

- [x] Mobilappen: Byta taskfilter utan att tasks försvinner.
- [x] Mobilappen: Mörk bakgrund i notes- och sök-vy i dark mode.
- [x] Mobilappen: Byta projekt-ikon utan IconPickerModal-fel.
- [x] Mobilappen: Visa projektikoner bredvid projektmappar i projektväljaren.
- [x] Mobilappen: Visa appversion och buildnummer i settings.
- [x] Mobilappen: Uppdatera buildnummer automatiskt vid varje build.
- [x] Mobilappen: Håll senaste buildnumret uppdaterat i mobile README.
- [x] Webbappen: Håll senaste buildnumret uppdaterat i web README.
- [x] Mobilappen: Drag-&-drop notes ska aktivera och spara "custom" sortering.
- [x] Mobilappen: Notes sorteringsdropdown ska alltid öppnas (även efter många tryck).
- [x] Mobilappen: Notes "custom" sortering ska matcha webbens ordning (verifieras).
- [x] Mobilappen: Markera dagens datum i kalendern (dag/vecka/månad/agenda).
- [x] Webb + mobil: Skapa ny task genom att trycka i kalendern (dag/vecka/månad).
- [x] Mobilappen: Drag-&-drop tasks i kalendern för att ändra tid/dag (dag/vecka/månad).
- [x] Webbappen: Tabeller ska renderas med både rader och kolumner.
- [x] Webbappen: Skapa tabeller i notes med samma format som mobilen.
- [x] Webbappen: Copy/paste av tabeller och parsing av inklistrad markup.
- [x] Webb + mobil: Synka formattering (tabeller, listor, checkboxes, textformat).
- [x] Genomgång: Förbättra stabilitet och hastighet i mobile/web/backend.
- [x] Mobilappen: Markerad tasklista visar mjuk bakgrundsfärg utan checkmark.
- [x] Mobilappen: "Alla"-listan markeras tydligt med samma bubbelfärg.
- [x] Mobilappen: Agenda-läget behåller Dag/Vecka/Månad/Agenda-knappar.
- [x] Mobilappen: Task drag-&-drop i dag/vecka placerar korrekt och visar outline.
- [x] Mobilappen: Dagens datum-markering är mjukare och bara i header-rutan.
- [x] Mobilappen: Projektväljare-longpress meny öppnar alltid stabilt.
- [x] Mobilappen: Mer luft ovanför första tasken i listvy.
- [x] Webbappen: Bekräftelse-dialog innan borttagning av task i listvy.
- [x] Mobilappen: Lägg till "Gå till idag" i kalenderheadern.
- [x] Mobilappen: Agenda-rubriker ska visa lokaliserat datumformat.
- [x] Mobilappen: Spara ändringar offline och synka när nät återkommer.
- [x] Mobilappen: Matcha tasklist-bubbla och kalenderdag mot FAB-lila.
- [x] Mobilappen: Konsolidera TaskCalendar och TaskTimeline till en vy.
- [x] Mobilappen: Ta bort TaskCalendar-komponenten efter konsolidering.
- [x] Mobilappen: Uppdatera StyledText-snapshot så mobiltester passerar.
- [x] Kvalitet: Lint, typecheck och tester gröna (mobil + webb).
- [x] Mobilappen: Minimera console.log och debugkod i produktion.
- [x] Mobilappen: Stöd för nästlad drag-och-släpp i trädvy (cross-level).
- [x] Mobilappen: Fixa trippel-synk av tasks vid återanslutning.
- [x] Webbappen: Fixa radbrytnings-mismatch mot mobilappen (Web visar fler radbrytningar).
- [x] Mobilappen: Konfigurera och bygg APK (EAS).
- [x] Webb + Mobil: Sortering efter prioritet (Högst först, klara sist).
- [x] Mobilappen: Autosave för notes vid navigering bakåt/lämna.
- [x] Mobilappen: App-lås inställning via dropdown istället för cykel-knapp.
- [x] Mobilappen: Optimistiska uppdateringar och offline-first (spara lokalt direkt).
- [x] Mobilappen: Fixa `uuidv4` byggfel.
- [x] Mobilappen: Fixa krasch i settings (`cycleLockTiming`).
- [x] Mobilappen: Ta bort duplicerad sorteringsknapp i tasks-vyn.
- [x] Mobilappen: Justera "No internet connection"-indikator (mindre, centrerad, transparent).
- [x] Webbappen: Fixa byggfel i `NoteEditor.tsx` (extra klammerparentes).

## Kommande förbättringsförslag
1. **Biometrisk inloggning**: Stöd för FaceID/TouchID i mobilappen.
2. **Röstanteckningar**: Spela in ljud direkt i en note (Mobil).
3. **Bilder i tasks**: Bifoga bilder till tasks.
4. **Sök i innehåll**: Utöka sökningen till att inkludera innehåll i tasks/notes.
5. **Taggar**: Stöd för #taggar i notes.
6. **Export**: Exportera notes till PDF/Markdown (Mobil).
