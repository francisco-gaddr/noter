# Implementeringsplan för Mobilapplikationen "Noter" (React Native Expo)

Denna implementeringsplan är en detaljerad, steg-för-steg-guide för full implementering av mobilapplikationen "Noter" i React Native med Expo, med integration mot Node.js-backend och MongoDB. Planen är sorterad efter prioritet för att prioritera grundfunktionalitet och snabb validering av core features. Vi börjar med setup av grundstruktur, backend (om inte redan från webb) och enkel frontend för att snabbt få en fungerande app körande i Expo Go eller emulator (t.ex. Android Studio för Android, Xcode för iOS). Använd demo-user initialt (hårdkodad ID) för att undvika full autentisering tidigt. Användarskapande, devops (t.ex. CI/CD, deployment till app stores) och GitHub-uppsättning skjuts upp till sist. Alla open source-bibliotek (t.ex. Expo, React Native, expo-local-authentication, vosk-api) prioriteras för implementation.

Planen inkluderar alla nödvändiga tasks och subtasks för full funktionalitet baserat på kravspecifikationen, inklusive biometri (fingeravtryck för Android), diktering och E2E-kryptering. Varje task/subtask har en [ ]-checkbox för att markera färdigställande (t.ex. [x] när klar). Fokusera på att testa varje steg lokalt i Expo (t.ex. med `expo start` och Expo Go-appen på mobil/enhet) för att säkerställa att grunderna fungerar tidigt. Använd TypeScript överallt för typssäkerhet. Kodstruktur: Använd monorepo med Turborepo för delad kod (t.ex. typer, krypteringsutility) med webb och backend.

## Prioritet 1: Grundsetup och Struktur (Få appen körande i Expo)
[x] Installera nödvändiga verktyg och initiera projekt.
   [x] Installera Node.js 20+ och npm/yarn globalt (om inte redan).
   [x] Installera Expo CLI: `npm install -g expo-cli`.
   [x] Skapa monorepo-mapp (om inte från webb): `mkdir noter-app && cd noter-app`.
   [x] Initiera Turborepo: `npx create-turbo@latest` (välj TypeScript, inkludera packages för delad kod).
   [x] Konfigurera ESLint och Prettier: Lägg till dependencies (`eslint`, `prettier`, `@typescript-eslint/eslint-plugin`), skapa `.eslintrc.json` med Airbnb-preset och `.prettierrc`.
   [x] Skapa `/packages/shared` för delad kod (t.ex. typer: `npm init -y`, lägg till TypeScript).

[x] Sätt upp backend-grund (Node.js med Express och MongoDB, om inte redan från webb-planen).
   [x] Skapa backend-mapp: `/apps/backend` (återanvänd från webb om möjligt).
   [x] Initiera: `npm init -y`, installera dependencies: `express`, `mongoose`, `typescript`, `ts-node`, `dotenv`, `@types/express`, `@types/node`.
   [x] Konfigurera tsconfig.json för TypeScript (target: ES2020, module: commonjs).
   [x] Skapa `index.ts`: Grund Express-server (`const app = express(); app.listen(3000);`).
   [x] Installera MongoDB lokalt (Community Edition) eller använd MongoDB Atlas (gratis tier); sätt upp env-variabel `MONGO_URI` i `.env`.
   [x] Testa: Kör `ts-node index.ts` och besök localhost:3000.

[x] Sätt upp mobil-frontend-grund (React Native Expo).
   [x] Skapa mobil-mapp: `/apps/mobile`.
   [x] Initiera Expo-projekt: `npx create-expo-app . --template tabs@50` (med TypeScript).
   [x] Installera ytterligare dependencies: `zustand`, `react-hook-form`, `yup`, `react-native-rich-editor`, `expo-crypto`, `socket.io-client`, `expo-sqlite`, `expo-offline` (ersatt av @react-native-community/netinfo), `expo-local-authentication`, `expo-speech`, `expo-av`, `expo-vector-icons`, `@shopify/flash-list`, `react-native-paper`, `@gorhom/bottom-sheet`, `lodash`, `fuse.js`, `expo-print`, `expo-sharing`, `expo-notifications`, `expo-background-fetch`, `expo-task-manager`, `twrnc` (för Tailwind), `expo-image-picker`, `react-native-webview`, `expo-router`.
   [x] Konfigurera Tailwind: Installera twrnc och konfigurera i app-entry.
   [x] Uppdatera `app.json`: Lägg till plugins för expo-local-authentication, expo-notifications etc.
   [x] Skapa grundlayout i `/app/_layout.tsx`: Inkludera theme-provider och root navigator.
   [x] Testa: Kör `expo start` (eller `yarn start`), skanna QR-kod med Expo Go-appen på mobil/enhet (Android/iOS) för att köra appen live.

[x] Integrera monorepo: Konfigurera Turborepo pipelines i `turbo.json` för build/dev (t.ex. `dev:mobile` kör Expo, `dev:backend` kör Express).

## Prioritet 2: Backend Core (Schemas och API för Notes/Tasks med Demo-User)
[x] Definiera schemas i Mongoose.
   [x] Skapa `/src/models/Note.ts`: `{ userId: string (demo: 'demo-user'), title: string (krypterad), content: string (krypterad), createdAt: Date, updatedAt: Date, tags: [string], parentId: Schema.Types.ObjectId, locked: boolean }`.
   [x] Skapa `/src/models/Task.ts`: `{ userId: string, title: string (krypterad), description: string (krypterad), dueDate: Date, completed: boolean, priority: number (1-5), parentNoteId: Schema.Types.ObjectId }`.
   [x] Skapa `/src/models/User.ts`: Grundschema för senare `{ email: string, passwordHash: string, theme: string }` (använd 'demo-user' som hårdkodad ID initialt).
   [x] Använd Mongoose: `mongoose.connect(process.env.MONGO_URI)` i `index.ts`.

[x] Skapa RESTful API-endpoints för Notes och Tasks (använd demo-user för access).
   [x] Skapa `/src/routes/notes.ts` och `/src/routes/tasks.ts`: Express Routers.
   [x] Implementera GET /api/notes: Hämta alla notes för 'demo-user' (query: filter tags, sort createdAt).
   [x] Implementera POST /api/notes: Spara ny note (validera med Joi).
   [x] Implementera PUT /api/notes/:id: Uppdatera note (kontrollera userId).
   [x] Implementera DELETE /api/notes/:id: Ta bort note.
   [x] Upprepa för Tasks: GET/POST/PUT/DELETE /api/tasks.
   [x] Lägg till middleware för CORS och body-parser (`express.json()`).
   [x] Testa endpoints med Postman: Skapa/testa CRUD med demo-data.

[x] Lägg till validering och error-handling.
   [x] Installera Joi för request-validering.
   [x] Skapa global error-middleware: Hantera 400/500-fel.
   [x] Indexera MongoDB-fält (t.ex. userId, createdAt) för prestanda.

## Prioritet 3: Mobil Frontend Core (Grund UI och Notes/Tasks CRUD utan Kryptering)
[x] Implementera global state med Zustand.
   [x] Skapa `/stores/useStore.ts`: State för notes, tasks, theme, viewMode (initialt 'list').
   [x] Integrera i app: Wrap root med Provider.

[x] Skapa grund UI-komponenter och navigation.
   [x] Konfigurera expo-router: Skapa tabs för Notes, Tasks, Search i `/app/(tabs)`.
   [x] Skapa `<NoteList />`: Använd @shopify/flash-list för list/grid-vy.
   [x] Skapa `<RichEditor />`: Grund react-native-rich-editor med basic toolbar.
   [x] Skapa FAB: Använd react-native-paper för plus-knapp i nedre högra hörnet.
   [x] Skapa navbar/bottom sheet: För sök/filter med @gorhom/bottom-sheet (Implementerat som separat Sök-tab och Sorterings-meny).
   [x] Uppdatera `/app/index.tsx`: Grundskärm med listvy.

[x] Integrera API-calls för Notes/Tasks CRUD.
   [x] Skapa hooks: `useFetchNotes()` (GET med fetch), `useCreateNote()`, etc.
   [x] Hårdkoda 'demo-user' i headers för API-calls.
   [x] Implementera ny note/task: FAB-modal med React Hook Form (Task använder RHF, Note använder RichEditor).
   [x] Implementera edit/delete: Tryck på list-item för att öppna editor; auto-save med debounce.
   [x] Testa: Skapa/redigera notes/tasks i Expo Go, verifiera backend-synk.

[x] Lägg till sök och filtrering.
   [x] Integrera fuse.js i sökfält: Fuzzy search på titel/tags.
   [x] Lägg till sortering: Dropdown för createdAt asc/desc med lodash.

[x] Lägg till vy-preferenser.
   [x] Spara view ('list' | 'grid' | 'snippet') i state/expo-secure-store.

## Prioritet 4: Kryptering och Säkerhet (E2E)
[x] Implementera krypteringsutility i `/packages/shared`.
   [x] Skapa `encrypt.ts`: Använd expo-crypto för AES-256 med PBKDF2 (hårdkoda demo-nyckel initialt). (Använder crypto-js i shared för kompatibilitet).
   [x] Skapa decrypt-funktion.

[x] Integrera kryptering i frontend.
   [x] Uppdatera hooks: Kryptera content/title innan POST/PUT; decrypt vid GET.
   [x] Hantera locked-flag: Modal för extra pin vid locked notes (uppdatera schema).

[x] Uppdatera backend: Se till att endpoints lagrar cipher-text utan dekryptering. (Backend lagrar strängar, vilket fungerar automatiskt).

## Prioritet 5: Biometri och Låsning (Fingeravtryck för Android)
[x] Implementera biometri-utility.
   [x] Skapa hook `useBiometricAuth()`: Använd expo-local-authentication; kontrollera hardware (FINGERPRINT för Android).
   [x] Hantera fallback till pin/lösenord vid misslyckande (via AppLock UI).

[x] Integrera app-låsning.
   [x] Wrap root i autentiseringsgate: Kräva biometri vid app-start/efter inaktivitet (useEffect för timeout).
   [ ] För per-note/grupp: Kräva biometri vid öppning om locked; logga försök. (Kräver SecureStore för att spara lösenord, implementeras senare).

[ ] Testa på Android-emulator/enhet: Verifiera fingeravtryck fungerar i Expo Go.

## Prioritet 6: Avancerad Notes/Tasks-Funktionalitet
[x] Lägg till rich-formatering i editor.
   [x] Lägg till toolbar: Bold/italic/lists/hyperlinks i react-native-pell-rich-editor.

[x] Implementera embedding.
   [x] Bilder: expo-image-picker för uppladdning, konvertera till base64, infoga i editor.
   [x] Videor: Thumbnails med react-native-webview (via iframe i editor).
   [ ] Länkkort: Custom parsing för metadata (og:image, og:title).

[x] Implementera export.
   [x] PDF: expo-print för rendering av HTML till PDF.
   [x] Dela: expo-sharing för att dela .pdf.

[x] Integrera tasks-specifikt: Checklists i notes, priority och dueDate i task-editor.
   [x] Checklists: `actions.checkboxList` i RichEditor.
   [x] Priority/DueDate: Implementerat i TaskEditorScreen med DateTimePicker.

## Prioritet 7: Diktering och Röststyrning
[ ] Implementera diktering.
   [ ] Skapa hook `useDictation()`: expo-av för recording, expo-speech för TTS, vosk-api för transkription.
   [ ] Integrera bakgrund: expo-task-manager för continued recording.
   [ ] Infoga transkriberad text i editor.

[ ] Lägg till notifications för tasks: expo-notifications för reminders.

## Prioritet 8: Realtid och Offline-Stöd
[ ] Implementera WebSockets för realtid.
   [ ] Installera socket.io i backend: Emit 'noteUpdated' vid CRUD.
   [ ] I frontend: Anslut socket med socket.io-client; lyssna på updates och refresh state.
   [ ] Hantera konflikter: Använd updatedAt för merge med deepmerge.

[ ] Implementera offline-stöd.
   [ ] Använd expo-sqlite för lokal cache av notes/tasks.
   [ ] Skapa sync-hook: Vid online, synka med expo-background-fetch.
   [ ] Hantera nätverksdetektion med expo-offline.

## Prioritet 9: Full Autentisering och Användarhantering
[ ] Implementera user-schema och autentisering i backend.
   [ ] Lägg till bcryptjs för password-hash.
   [ ] Skapa /api/auth/register och /api/auth/login: Generera JWT med jsonwebtoken.
   [ ] Lägg till auth-middleware för protected routes (ersätt demo-user).

[ ] I frontend: Implementera login/register-skärmar.
   [ ] Spara JWT i expo-secure-store; inkludera i headers.
   [ ] Implementera utloggning.

[ ] Integrera biometri i autentisering: Använd för lösenordslåsning.

## Prioritet 10: Tillgänglighet, Internationellisering och Testning
[ ] Lägg till tillgänglighetsstöd: VoiceOver/TalkBack-attribut i komponenter.
[ ] Implementera react-i18next för svenska/engelska.
[ ] Sätt upp testning: Jest för unit (hooks/komponenter), Detox för E2E.

## Prioritet 11: Prestanda och Säkerhetsoptimeringar
[ ] Optimera: Use useMemo/useCallback; virtualized lists.
[ ] Säkerhet: Rate-limiting i backend; secure-store för nycklar.
[ ] Audit: Kör snyk för vulnerabilities.

## Prioritet 12: Devops, Deployment och GitHub
[ ] Konfigurera devops: EAS för builds (expo eas build).
[ ] Deploya backend: Heroku/DigitalOcean med MongoDB Atlas.
[ ] Deploya mobil: Expo EAS submit till App Store/Google Play.
[ ] Sätt upp CI/CD med GitHub Actions.
[ ] Initiera GitHub-repo: `git init`, push till remote (lägg till .gitignore för env-filer).