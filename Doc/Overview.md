# Dokumentation och Kravspecifikation för Webbapplikationen "Noter"

Detaljerad kravspecifikation (kravställning) för webbapplikationen "Noter", en anteckningsapp fokuserad på enkelhet, modern design och säkerhet med full end-to-end (E2E)-kryptering. Dokumentet är utformat för att tjäna som grund för implementeringsplanen, inklusive kodutveckling, testning och deployment. Det prioriterar open source-bibliotek och verktyg för att minimera beroenden, främja community-bidrag och säkerställa långsiktig hållbarhet. Alla krav är specificerade med fokus på programmeringsrelaterade aspekter, såsom API-integrationer, komponentstruktur, algoritmer och kodexempel (pseudokod).

Dokumentet är strukturerat för att vara heltäckande: Det inkluderar funktionella och icke-funktionella krav, tekniska specifikationer, implementeringsdetaljer, säkerhetskrav, prestandaoptimeringar, teststrategier och framtida utökningar. Krav är numrerade för spårbarhet (t.ex. FR-1 för funktionella krav). Alla rekommendationer baseras på open source-principer, med explicita bibliotek och verktyg angivna.

## 1. Introduktion

### 1.1 Syfte och Omfattning
"Noter" är en webbapplikation för att skapa, hantera och synkronisera anteckningar (notes) med stöd för rich-text-formatering, hierarkisk organisation, embedding av media och exportfunktioner. Appen integreras med en Node.js-backend och MongoDB för persistens, samt synkroniseras med en mobilapp (React Native Expo) via gemensam API. Omfattningen inkluderar full implementering av webb-frontend i Next.js, med fokus på E2E-kryptering där all data krypteras på klienten.

Syftet med denna kravspecifikation är att:
- Definiera alla funktioner med tekniska detaljer för kodimplementering.
- Specificera teknikstack och open source-bibliotek.
- Tillhandahålla en blueprint för utveckling, inklusive kodstruktur och pseudokod.
- Säkerställa att appen är säker, skalbar och offline-kapabel.

### 1.2 Målgrupp och Användarscenarier
- **Målgrupp**: Individer och team som behöver en säker anteckningsapp, t.ex. studenter, utvecklare eller professionella. Anta vuxna användare med grundläggande teknisk kunskap.
- **Användarscenarier**:
  - En användare loggar in, skapar en ny anteckning med rich-text, lägger till en bild och exporterar som PDF.
  - Användaren organiserar anteckningar i en trädstruktur och söker via fuzzy search.
  - Offline: Användaren redigerar anteckningar utan nätverk, synkroniseras vid återanslutning.

### 1.3 Definitioner och Förkortningar
- **Note**: Huvudentitet – en rich-text-baserad anteckning med titel, innehåll, taggar och hierarki (parent/child).
- **E2E-Kryptering**: Data krypteras/decrypteras på klienten; servern hanterar endast cipher-text.
- **Open Source-Bibliotek**: Prioriteras för alla funktioner, t.ex. CryptoJS för kryptering.
- **SSR/SSG**: Server-Side Rendering/Static Site Generation i Next.js.

## 2. Systemöversikt

### 2.1 Arkitektur
- **Client-Server-Modell**: Webb-frontend (Next.js) kommunicerar med backend via RESTful API och WebSockets för realtid.
- **Komponentbaserad Struktur**: React-komponenter för UI, med hooks för logik.
- **Dataflöde**:
  1. Användare autentiseras via JWT.
  2. Data hämtas från backend (krypterad).
  3. Klienten decrypterar, redigerar och krypterar innan save.
  4. Synk via Socket.io för multi-device.
- **Offline-Stöd**: PWA med service workers; lokal cache i IndexedDB.
- **Monorepo**: Använd Turborepo för delad kod mellan web, mobil och backend (t.ex. typer i TypeScript).

### 2.2 Teknikstack
- **Frontend**: Next.js 14+ (React 18+), TypeScript 5+.
- **Styling**: Tailwind CSS 3+ (open source) för responsiv design.
- **State Management**: Zustand 4+ (open source, lättviktig alternativ till Redux).
- **Formhantering**: React Hook Form 7+ med Yup 1+ för validering.
- **Routing**: Next.js inbyggd app-router.
- **Editor**: Slate-react 0.9+ (open source rich-text editor).
- **Kryptering**: CryptoJS 4+ för AES-256; PBKDF2 för nyckelgenerering.
- **Realtid**: Socket.io-client 4+.
- **Offline**: Workbox 7+ för PWA; idb 3+ för IndexedDB.
- **Andra Bibliotek**: react-sortable-tree för trädstruktur; fuse.js för sök; jsPDF + html2canvas för export; react-icons för ikoner; lodash för utility.
- **Verktyg**: ESLint med Airbnb-preset; Prettier för formatering; Jest + React Testing Library för testning.
- **Miljö**: Node.js 20+ för utveckling; Vercel för deployment.

Alla bibliotek ska installeras via npm/yarn, med fokus på open source-licenser (MIT/BSD).

## 3. Funktionella Krav (FR)

Funktionella krav specificerar vad systemet ska göra, med detaljerade implementeringsinstruktioner, pseudokod och open source-integrationer.

### 3.1 Autentisering och Användarhantering
- **FR-1: Registrering**: Användare registrerar med email/lösenord. Backend validerar unikhet; hash lösenord med bcryptjs.
  - Implementering: POST /api/auth/register. Klient: Form med React Hook Form; validera email med Yup.
  - Pseudokod: `const onSubmit = async (data) => { const hashed = await bcrypt.hash(data.password); await fetch('/api/auth/register', { body: JSON.stringify({ email: data.email, password: hashed }) }); };`.
- **FR-2: Inloggning**: JWT-generering vid lyckad inloggning. Spara token i localStorage.
  - Implementering: POST /api/auth/login. Middleware för JWT-verifiering.
- **FR-3: Utloggning**: Rensa token och state.
- **FR-4: Låsning**: App låst efter inaktivitet (5 min). Custom modal för lösenord/biometri (web: lösenord).
  - Implementering: Använd useEffect för timeout; verifiera mot master-key.

### 3.2 Anteckningshantering (Notes)
- **FR-5: Skapa Note**: Ny note med titel, rich-text-innehåll, taggar och parentId för hierarki.
  - Implementering: Modal med Slate-editor. Kryptera content innan POST /api/notes.
  - Pseudokod: `const encrypted = CryptoJS.AES.encrypt(JSON.stringify(editorState), key); await fetch('/api/notes', { body: JSON.stringify({ title, content: encrypted, tags }) });`.
- **FR-6: Redigera Note**: Öppna i huvudvy; realtidsspara med debounce (lodash).
  - Implementering: Slate-react med plugins för formatering (bold, lists, hyperlinks).
- **FR-7: Ta Bort Note**: DELETE /api/notes/:id; cascade för children.
- **FR-8: Organisera i Hierarki**: Trädstruktur i sidopanel med drag-and-drop.
  - Implementering: react-sortable-tree; uppdatera parentId via PUT.
- **FR-9: Sök och Filtrera**: Fuzzy search på titel/tags/tid; sortera asc/desc.
  - Implementering: Fuse.js för sök; lodash.sortBy för sortering.
- **FR-10: Formatering**: Stöd bold/italic/underline, listor, code blocks, hyperlinks.
  - Implementering: Slate-plugins; custom toolbar-komponent.
- **FR-11: Embedding**: Bilder (base64 via react-dropzone), videor (react-player), länkkort (react-link-preview).
  - Implementering: Infoga i Slate som custom nodes; kryptera media-data.
- **FR-12: Export**: PDF (jsPDF + html2canvas), MD/TXT (turndown).
  - Implementering: Render editor till canvas; generera fil och ladda ner.

### 3.3 Synkronisering och Realtid
- **FR-13: Realtidsuppdateringar**: Synk mellan enheter via WebSockets.
  - Implementering: Socket.io; emit 'noteUpdated' vid save; lyssna och uppdatera state.
  - Konfliktlösning: Använd updatedAt; merge med deepmerge.
- **FR-14: Offline-Stöd**: Lagra changes i IndexedDB; synk vid reconnect.
  - Implementering: Workbox för caching; custom sync-hook.

### 3.4 UI/UX och Design
- **FR-15: Tema**: Dark/light mode med synk.
  - Implementering: next-themes; toggle i navbar.
- **FR-16: Responsiv Design**: Fullt responsiv för desktop/mobile.
  - Implementering: Tailwind media queries; test med Chrome DevTools.
- **FR-17: Vy-preferenser**: Spara view (tree/list) i Zustand/backend.

### 3.5 Integration med Tasks (Uppgifter)
- **FR-18: Skapa/Hantera Tasks**: Separat entitet länkad till notes (parentNoteId).
  - Implementering: Liknande notes, med extra fält (dueDate, priority). Checklists i notes via Slate-plugin.

## 4. Icke-Funktionella Krav (NFR)

### 4.1 Säkerhet
- **NFR-1: E2E-Kryptering**: All data krypterad med AES-256; nyckel härleds från lösenord (PBKDF2, 10000 iterationer).
  - Implementering: Inga okrypterade data på server; HTTPS med Let's Encrypt.
- **NFR-2: Autentiseringssäkerhet**: JWT med kort livstid (15 min); refresh tokens.
- **NFR-3: Dataskydd**: Rate-limiting; input sanitization med validator.js.
- **NFR-4: Låsning**: Biometri-stöd via custom implementation; audit logs i backend.

### 4.2 Prestanda
- **NFR-5: Laddningstid**: <2s för initial load (SSR i Next.js).
  - Implementering: Lazy-loading; code-splitting med dynamic imports.
- **NFR-6: Skalbarhet**: Hantera 1000+ notes per user; indexering i MongoDB.
- **NFR-7: Offline-Prestanda**: Snabb lokal access via IndexedDB.

### 4.3 Tillgänglighet och Användbarhet
- **NFR-8: ARIA**: Alla komponenter med ARIA-attribut; test med axe-core.
- **NFR-9: Internationellisering**: react-i18next för multi-language.
- **NFR-10: Felhantering**: Graceful errors; toast-notifications med react-hot-toast.

### 4.4 Tillförlitlighet
- **NFR-11: Backup**: Automatisk synk; export-funktion för data.
- **NFR-12: Kompatibilitet**: Stöd Chrome/Firefox/Safari senaste versioner.

## 5. Implementeringsdetaljer

### 5.1 Kodstruktur
- **Mappstruktur**:
  - `/app`: Next.js pages/routes (t.ex. /notes/[id]).
  - `/components`: Återanvändbara (e.g. <NoteEditor />, <SidebarTree />).
  - `/hooks`: Custom hooks (e.g. useEncrypt(), useSync()).
  - `/lib`: Utility (e.g. encrypt.js med CryptoJS).
  - `/stores`: Zustand stores.
  - `/types`: TypeScript interfaces (e.g. interface Note { id: string; content: string; }).
- **Exempelkomponent**: <NoteEditor />: `const NoteEditor = ({ initialValue }) => { const editor = useSlate(); return <Slate editor={editor} value={initialValue}><Editable /></Slate>; };`.

### 5.2 API-Specifikation
- **Endpoints**: Dokumentera med OpenAPI (swagger-jsdoc).
  - GET /api/notes: Returnera [{id, title (dekrypterad på klient), ...}].
- **Error Codes**: 401 Unauthorized, 500 Internal.

### 5.3 Teststrategi
- **Unit Tests**: Jest för komponenter/hooks (t.ex. test encrypt/decrypt).
- **Integration Tests**: React Testing Library för flows (t.ex. create note).
- **E2E Tests**: Cypress för UI-interaktioner.
- **Coverage**: >80% med istanbul.

### 5.4 Deployment och CI/CD
- **Deployment**: Vercel för hosting; auto-deploys från GitHub.
- **CI/CD**: GitHub Actions för build/test/deploy.
- **Miljövariabler**: dotenv för secrets (JWT_SECRET, MONGO_URI).

## 6. Framtida Utökningar
- **AI-Integration**: transformers.js för lokal sammanfattning.
- **Samarbete**: yjs för realtid collab.
- **Analytics**: Matomo för användarstatistik.
- **Phased Rollout**: MVP: Core notes (4 veckor); Full: Tasks + offline (2 veckor).

