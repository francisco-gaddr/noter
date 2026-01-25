# Implementeringsplan för Webbapplikationen "Noter"

Denna implementeringsplan är en detaljerad, steg-för-steg-guide för full implementering av webbapplikationen "Noter" i Next.js, med integration mot Node.js-backend och MongoDB. Planen är sorterad efter prioritet för att prioritera grundfunktionalitet och snabb validering av core features. Vi börjar med setup av grundstruktur, backend och enkel frontend för att snabbt få en fungerande fullstack-MVP (Minimum Viable Product) med demo-user (ingen full autentisering initialt). Användarskapande och full autentisering skjuts upp, liksom GitHub-uppsättning (som placeras sist). Alla open source-bibliotek (t.ex. Next.js, Express, Mongoose, CryptoJS) prioriteras för implementation.

Planen inkluderar alla nödvändiga tasks och subtasks för full funktionalitet baserat på kravspecifikationen. Varje task/subtask har en [ ]-checkbox för att markera färdigställande (t.ex. [x] när klar). Fokusera på att testa varje steg lokalt (t.ex. med `npm run dev`) för att säkerställa att grunderna fungerar tidigt. Använd TypeScript överallt för typssäkerhet. Kodstruktur: Använd monorepo med Turborepo för delad kod (t.ex. typer, utility för kryptering).

## Prioritet 1: Grundsetup och Struktur (Få en tom fullstack-app körande)
[x] Installera nödvändiga verktyg och initiera projekt.
   [x] Installera Node.js 20+ och npm/yarn globalt.
   [x] Skapa monorepo-mapp: `mkdir noter-app && cd noter-app`.
   [x] Initiera Turborepo: `npx create-turbo@latest` (välj TypeScript, inkludera packages för delad kod).
   [x] Konfigurera ESLint och Prettier: Lägg till dependencies (`eslint`, `prettier`, `@typescript-eslint/eslint-plugin`), skapa `.eslintrc.json` med Airbnb-preset och `.prettierrc`.
   [x] Skapa `/packages/shared` för delad kod (t.ex. typer: `npm init -y`, lägg till TypeScript).

[x] Sätt upp backend-grund (Node.js med Express och MongoDB).
   [x] Skapa backend-mapp: `/apps/backend`.
   [x] Initiera: `npm init -y`, installera dependencies: `express`, `mongoose`, `typescript`, `ts-node`, `dotenv`, `@types/express`, `@types/node`.
   [x] Konfigurera tsconfig.json för TypeScript (target: ES2020, module: commonjs).
   [x] Skapa `index.ts`: Grund Express-server (`const app = express(); app.listen(3000);`).
   [x] Installera MongoDB lokalt (Community Edition) eller använd MongoDB Atlas (gratis tier); sätt upp env-variabel `MONGO_URI` i `.env`.
   [x] Testa: Kör `ts-node index.ts` och besök localhost:3000.

[x] Sätt upp frontend-grund (Next.js).
   [x] Skapa frontend-mapp: `/apps/web`.
   [x] Initiera Next.js: `npx create-next-app@latest .` (med TypeScript, app-router, Tailwind CSS).
   [x] Installera ytterligare dependencies: `zustand`, `react-hook-form`, `yup`, `slate-react`, `crypto-js`, `socket.io-client`, `idb`, `workbox-window`, `react-sortable-tree`, `fuse.js`, `jspdf`, `html2canvas`, `turndown`, `react-dropzone`, `react-player`, `react-link-preview`, `react-icons`, `lodash`, `next-themes`.
   [x] Konfigurera Tailwind: Uppdatera `tailwind.config.js` med dark-mode support.
   [x] Skapa grundlayout i `/app/layout.tsx`: Inkludera theme-provider från next-themes.
   [x] Testa: Kör `npm run dev` och besök localhost:3000.

[x] Integrera monorepo: Konfigurera Turborepo pipelines i `turbo.json` för build/dev (t.ex. `dev:web` kör Next.js, `dev:backend` kör Express).

## Prioritet 2: Backend Core (Schemas och API för Notes med Demo-User)
[x] Definiera schemas i Mongoose.
   [x] Skapa `/src/models/Note.ts`: `{ userId: string (demo: 'demo-user'), title: string (krypterad), content: string (krypterad), createdAt: Date, updatedAt: Date, tags: [string], parentId: Schema.Types.ObjectId, locked: boolean }`.
   [x] Skapa `/src/models/User.ts`: Grundschema för senare `{ email: string, passwordHash: string, theme: string }` (använd 'demo-user' som hårdkodad ID initialt).
   [x] Använd Mongoose: `mongoose.connect(process.env.MONGO_URI)` i `index.ts`.

[x] Skapa RESTful API-endpoints för Notes (använd demo-user för access).
   [x] Skapa `/src/routes/notes.ts`: Express Router.
   [x] Implementera GET /api/notes: Hämta alla notes för 'demo-user' (query: filter tags, sort createdAt).
   [x] Implementera POST /api/notes: Spara ny note (validera med Joi).
   [x] Implementera PUT /api/notes/:id: Uppdatera note (kontrollera userId).
   [x] Implementera DELETE /api/notes/:id: Ta bort note.
   [x] Lägg till middleware för CORS och body-parser (`express.json()`).
   [x] Testa endpoints med Postman: Skapa/testa CRUD med demo-data.

[x] Lägg till validering och error-handling.
   [x] Installera Joi för request-validering.
   [x] Skapa global error-middleware: Hantera 400/500-fel.
   [x] Indexera MongoDB-fält (t.ex. userId, createdAt) för prestanda.

## Prioritet 3: Frontend Core (Grund UI och Notes CRUD utan Kryptering)
[x] Implementera global state med Zustand.
   [x] Skapa `/stores/useStore.ts`: State för notes, theme, viewMode (initialt 'tree').
   [x] Integrera i app: Wrap root med Provider.

[x] Skapa grund UI-komponenter.
   [x] Skapa `<SidebarTree />`: Använd react-sortable-tree för hierarkisk visning av notes.
   [x] Skapa `<NoteEditor />`: Grund Slate-react editor med basic plugins (bold, lists).
   [x] Skapa navbar: Sökfält, theme-toggle (next-themes).
   [x] Uppdatera `/app/page.tsx`: Layout med sidopanel och huvudvy.

[x] Integrera API-calls för Notes CRUD.
   [x] Skapa hooks: `useFetchNotes()` (GET med fetch), `useCreateNote()`, etc.
   [x] Hårdkoda 'demo-user' i headers för API-calls.
   [x] Implementera ny note: Plus-ikon i sidebar, modal med React Hook Form.
   [x] Implementera edit/delete: Klicka på tree-node för att ladda i editor; auto-save med debounce.
   [x] Testa: Skapa/redigera notes lokalt, verifiera backend-synk.

[x] Lägg till sök och filtrering.
   [x] Integrera fuse.js i sökfält: Fuzzy search på titel/tags.
   [x] Lägg till sortering: Dropdown för createdAt asc/desc med lodash.

## Prioritet 4: Kryptering och Säkerhet (E2E)
[x] Implementera krypteringsutility i `/packages/shared`.
   [x] Skapa `encrypt.ts`: Använd CryptoJS AES-256 med PBKDF2 för nyckel (hårdkoda demo-nyckel initialt).
   [x] Skapa decrypt-funktion.

[x] Integrera kryptering i frontend.
   [x] Uppdatera hooks: Kryptera content/title innan POST/PUT; decrypt vid GET.
   [x] Hantera locked-flag: Modal för extra lösenord vid locked notes (uppdatera schema).

[x] Uppdatera backend: Se till att endpoints lagrar cipher-text utan dekryptering.

## Prioritet 5: Avancerad Notes-Funktionalitet
[x] Utöka rich-formatting i editorn.
   [x] Lägg till stöd för: Italic, underline, code blocks, hyperlinks.
   [x] Listor (Numrerade/Onumrerade), Headings, Block Quotes.
   [x] Skapa en custom toolbar component (utökad).

[x] Implementera embedding.
   [x] Bilder: Upload -> convert to base64 -> insert into Slate.
   [x] Videos: `react-player` för embed (via URL).
   [ ] Link cards: `react-link-preview` för metadata (Future).

[x] Implementera export.
   [x] PDF: `jsPDF` med `html2canvas`.
   [x] MD: `turndown`.

[x] Lägg till view preferences.
   [x] Toggle mellan tree/list i Sidebar.

## Prioritet 5.5: UI/UX Förbättringar (Extrafunktioner)
[x] Implementera Custom Ikoner.
   [x] Uppdatera datamodell (icon fält).
   [x] Skapa IconPicker-komponent (SVG-bibliotek).
   [x] Visa vald ikon i Sidebar och Editor header.
[x] Slutföra drag-and-drop i sidopanelen (nestning och order-synk).

[x] Implementera Arvd Låsning.
   [x] Logik: Om en förälder är låst, är alla barn låsta.
   [x] Frontend: Rekursiv kontroll av lås-status vid navigering.

[x] Implementera Resizable Sidebar.
   [x] Drag-handle för att ändra bredd på sidebar.
   [x] Spara bredd i localStorage/store.

## Prioritet 6: Realtid och Offline-Stöd
[x] Implementera WebSockets för realtid.
   [x] Installera socket.io i backend: Emit 'noteUpdated' vid CRUD.
   [x] I frontend: Anslut socket med socket.io-client; lyssna på updates och refresh state.
   [x] Hantera konflikter: Använd updatedAt för merge med deepmerge.

[x] Implementera offline-stöd.
   [x] Registrera PWA service worker med Next.js.
   [x] Använd idb för lokal cache av notes.
   [x] Skapa sync-hook: Vid online, synka lokal changes till backend.

## Prioritet 7: Tasks-Integration
[x] Uppdatera backend: Lägg till Task-schema `{ userId, title (krypterad), description, dueDate, completed, priority, parentNoteId }`.
   [x] Skapa API-endpoints för Tasks CRUD.

[x] I frontend: Lägg till Task-vy i sidebar.
   [x] Skapa `<TaskList />` och editor.
   [x] Integrera checklists i Note-editor (Slate-plugin).
[x] Förhindra dubbelskapande vid skapande (socket-deduplikation för notes/tasks).
[x] Säkerställ unika listnycklar via dedup (uniqBy på _id) i state.

## Prioritet 8: Full Autentisering och Användarhantering
[x] Implementera user-schema och autentisering i backend.
   [x] Lägg till bcryptjs för password-hash.
   [x] Skapa /api/auth/register och /api/auth/login: Generera JWT med jsonwebtoken.
   [x] Lägg till auth-middleware för protected routes (ersätt demo-user).

[x] I frontend: Implementera login/register-sidor.
   [x] Spara JWT i localStorage; inkludera i headers.
   [x] Implementera utloggning.

[x] Lägg till app-låsning.
   [x] Timeout för inaktivitet; custom modal för lösenord.

## Prioritet 9: Tillgänglighet, Internationellisering och Testning
[x] Lägg till ARIA-attribut i komponenter.
[x] Integrera axe-core i dev för automatisk skanning i konsolen.
[x] Testa med axe-core och åtgärda eventuella tillgänglighetsfel.
[x] Implementera react-i18next för svenska/engelska.
[ ] Sätt upp testning: Jest för unit (hooks/komponenter), Cypress för E2E.

## Prioritet 10: Prestanda och Säkerhetsoptimeringar
[ ] Optimera: Lazy-load komponenter med Next.js dynamic; useMemo i editor.
[ ] Säkerhet: Rate-limiting i backend (express-rate-limit); CSP i Next.js.
[ ] Audit: Kör snyk för vulnerabilities.

## Prioritet 11: Deployment och GitHub
[ ] Deploya backend: Heroku/DigitalOcean med MongoDB Atlas.
[ ] Deploya frontend: Vercel.
[ ] Sätt upp CI/CD med GitHub Actions.
[ ] Initiera GitHub-repo: `git init`, push till remote (lägg till .gitignore för env-filer).
